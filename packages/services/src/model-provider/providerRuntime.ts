import {
  NodeModelSelectionConfigRepository,
  createNodeModelSelectionFacade,
} from "@zcode/provider-node";
import {
  ProviderRegistryService,
  ProviderSettingsFacade,
  createFailClosedAccountProviderConfigSnapshot,
  type AccountProviderConfigSnapshot,
  type ProviderConfigSnapshot,
  type ProviderSettingsMutationTarget,
  type ProviderSource,
} from "@zcode/provider";
import { BUILTIN_PROVIDER_TEMPLATE_IDS } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  createProviderConfigRuntime,
  type ProviderConfigRuntime,
  type ProviderConfigRuntimeOptions,
} from "./providerConfigRuntime.js";
import {
  createModelSelectionService,
  createProviderSettingsService,
  type AiProxyCatalogFetcher,
  type IModelSelectionService,
  type IProviderSettingsService,
  type ModelSelectionConfiguredDefaultSource,
  type ProviderSettingsConnectivityTester,
} from "./providerFacadeServices.js";

export interface ProviderRuntimeOptions extends ProviderConfigRuntimeOptions {
  readonly accountSource?: RefreshableProviderSource<AccountProviderConfigSnapshot>;
  readonly testConnectivity?: ProviderSettingsConnectivityTester;
  readonly fetchAiProxyCatalog?: AiProxyCatalogFetcher;
}

export interface ProviderRuntimeDependencies {
  readonly configRuntime: ProviderConfigRuntime;
  readonly accountSource?: RefreshableProviderSource<AccountProviderConfigSnapshot>;
  readonly disposeAccountSource?: () => void;
  readonly testConnectivity?: ProviderSettingsConnectivityTester;
  readonly fetchAiProxyCatalog?: AiProxyCatalogFetcher;
  readonly modelSelectionConfiguredDefaultSource?: ModelSelectionConfiguredDefaultSource;
  readonly disposeModelSelectionConfiguredDefaultSource?: () => void;
}

interface RefreshableProviderSource<TSnapshot> extends ProviderSource<TSnapshot> {
  refresh?(reason: string): Promise<TSnapshot>;
}

const log = createServiceLogger("provider-runtime");

/**
 * 网关模型目录自动刷新间隔。网关的模型集合变化是低频事件（上架/下线/改档位），
 * 每半小时问一次足够跟上，也不会把长会话里的网关查询变成负担。
 */
const AI_PROXY_MODEL_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 普通 API Provider 可以在账号能力尚未装配时独立运行。
 * Account Provider 由当前 Built-in revision 对齐的 access.entitled=false Overlay 显式 fail-closed。
 */
export class EmptyAccountProviderConfigSource implements ProviderSource<AccountProviderConfigSnapshot> {
  constructor(readonly configSource: ProviderSource<ProviderConfigSnapshot>) {}

  async read(): Promise<AccountProviderConfigSnapshot> {
    return createFailClosedAccountProviderConfigSnapshot(await this.configSource.read());
  }

  onDidChange(): () => void {
    return () => {};
  }
}

/** 组装一个进程内共享的 Provider Config、Registry 与 Facade。 */
export class ProviderRuntime {
  readonly configService: ProviderConfigRuntime["configService"];
  readonly registryService: ProviderRegistryService;
  readonly providerSettings: IProviderSettingsService;
  readonly modelSelection: IModelSelectionService;
  readonly #configRuntime: ProviderConfigRuntime;
  readonly #disposeAccountSource?: () => void;
  readonly #disposeBuiltinRecovery: () => void;
  readonly #modelSelectionRuntime: IModelSelectionService & { dispose(): void };
  #aiProxySyncTimer: ReturnType<typeof setInterval> | null = null;
  #aiProxySyncInFlight: Promise<void> | null = null;
  readonly #disposeModelSelectionConfiguredDefaultSource?: () => void;
  #startPromise: ReturnType<ProviderRegistryService["start"]> | null = null;
  #disposed = false;

  constructor(dependencies: ProviderRuntimeDependencies) {
    this.#configRuntime = dependencies.configRuntime;
    this.#disposeAccountSource = dependencies.disposeAccountSource;
    this.#disposeModelSelectionConfiguredDefaultSource =
      dependencies.disposeModelSelectionConfiguredDefaultSource;
    this.configService = this.#configRuntime.configService;
    const accountSource: RefreshableProviderSource<AccountProviderConfigSnapshot> =
      dependencies.accountSource ?? new EmptyAccountProviderConfigSource(this.configService);
    this.#disposeBuiltinRecovery = this.#configRuntime.onDidCheckZCodeBuiltin(async () => {
      const [config, account] = await Promise.all([
        this.configService.read(),
        accountSource.read(),
      ]);
      if (!this.#disposed && config.zcodeBuiltinRevision !== account.basedOnZCodeBuiltinRevision) {
        await accountSource.refresh?.("builtin-account-recovery");
      }
    });
    this.registryService = new ProviderRegistryService({
      configSource: this.configService,
      accountSource,
    });
    const mutations = createSettingsMutationTarget(
      this.#configRuntime,
      this.registryService,
      accountSource,
    );
    const ensureReady = () => this.start();
    const settingsFacade = new ProviderSettingsFacade(this.registryService, mutations);
    this.providerSettings = createProviderSettingsService(
      settingsFacade,
      ensureReady,
      dependencies.testConnectivity,
      dependencies.fetchAiProxyCatalog,
    );
    this.#modelSelectionRuntime = createModelSelectionService(
      createNodeModelSelectionFacade(this.registryService),
      ensureReady,
      dependencies.modelSelectionConfiguredDefaultSource,
    );
    this.modelSelection = this.#modelSelectionRuntime;
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("ProviderRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.#configRuntime
      .start()
      .then(() => this.registryService.start())
      .then(() => {
        this.#startAiProxyModelSync();
      });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#aiProxySyncTimer) {
      clearInterval(this.#aiProxySyncTimer);
      this.#aiProxySyncTimer = null;
    }
    this.#disposeBuiltinRecovery();
    this.#modelSelectionRuntime.dispose();
    this.registryService.dispose();
    this.#disposeAccountSource?.();
    this.#disposeModelSelectionConfiguredDefaultSource?.();
    this.#configRuntime.dispose();
  }

  /**
   * 软件启动时同步一次网关模型目录，之后按固定间隔再同步。
   *
   * 单飞：启动同步、设置页打开与定时刷新可能同时触发，重复请求既浪费网关查询，
   * 也会让同一时刻有两次配置写入。失败只记录日志——网关不可达不该阻断启动，
   * 也不该把上一次同步出来的模型列表清空。
   */
  syncAiProxyGatewayModels(reason: string): Promise<void> {
    const inFlight = this.#aiProxySyncInFlight;
    if (inFlight) return inFlight;
    const run = this.#runAiProxyModelSync(reason).finally(() => {
      if (this.#aiProxySyncInFlight === run) this.#aiProxySyncInFlight = null;
    });
    this.#aiProxySyncInFlight = run;
    return run;
  }

  #startAiProxyModelSync(): void {
    void this.syncAiProxyGatewayModels("startup");
    if (this.#aiProxySyncTimer) return;
    this.#aiProxySyncTimer = setInterval(() => {
      void this.syncAiProxyGatewayModels("interval");
    }, AI_PROXY_MODEL_SYNC_INTERVAL_MS);
    // 定时器不是进程存活理由：只有 Host 还在跑的时候它才有意义。
    this.#aiProxySyncTimer.unref?.();
  }

  async #runAiProxyModelSync(reason: string): Promise<void> {
    if (this.#disposed) return;
    let view: Awaited<ReturnType<IProviderSettingsService["getView"]>>;
    try {
      view = await this.providerSettings.getView();
    } catch (error) {
      log.warn(undefined, "AI Proxy 模型同步读取 Provider 视图失败", { reason, error });
      return;
    }
    for (const provider of view.providers) {
      if (this.#disposed) return;
      if (provider.templateId !== BUILTIN_PROVIDER_TEMPLATE_IDS.aiProxy) continue;
      // 还没有凭据的 Provider（模板预设、用户没登录）保持原样：模板自带 access
      // 类型与网关地址，只有 apiKey 才是"这个 Provider 真的能请求网关"的证据。
      const access = provider.effectiveConfig.access;
      const apiKey = access?.type === "api-key" ? access.apiKey?.trim() : undefined;
      if (!apiKey || !provider.effectiveConfig.api?.baseUrl) continue;
      try {
        const result = await this.providerSettings.syncAiProxyModels(provider.providerId);
        log.info(undefined, "AI Proxy 模型目录已同步", {
          reason,
          providerId: provider.providerId,
          models: result.modelIds.length,
          skipped: result.skippedModelIds.length,
        });
      } catch (error) {
        log.warn(undefined, "AI Proxy 模型目录同步失败", {
          reason,
          providerId: provider.providerId,
          error,
        });
      }
    }
  }
}

function createSettingsMutationTarget(
  configRuntime: ProviderConfigRuntime,
  registryService: ProviderRegistryService,
  accountSource: RefreshableProviderSource<AccountProviderConfigSnapshot>,
): ProviderSettingsMutationTarget {
  const configService = configRuntime.configService;
  return {
    createPersonalProvider: (input) => configService.createPersonalProvider(input),
    savePersonalProviderOverlay: (providerId, config, membership, metadata) =>
      configService.savePersonalProviderOverlay(providerId, config, membership, metadata),
    deletePersonalProvider: (providerId) => configService.deletePersonalProvider(providerId),
    reorderPersonalProviders: (providerIds) => configService.reorderPersonalProviders(providerIds),
    reorderPersonalModels: (providerId, modelIds, membership) =>
      configService.reorderPersonalModels(providerId, modelIds, membership),
    // 手工四参数转发曾丢掉新增的配置模式；直接绑定完整签名，避免装配层截断写入意图。
    addPersonalModel: configService.addPersonalModel.bind(configService),
    replacePersonalModels: (providerId, models, membership) =>
      configService.replacePersonalModels(providerId, models, membership),
    renamePersonalModel: (providerId, currentModelId, nextModelId, membership) =>
      configService.renamePersonalModel(providerId, currentModelId, nextModelId, membership),
    deletePersonalModel: (providerId, modelId, membership) =>
      configService.deletePersonalModel(providerId, modelId, membership),
    setPersonalModelEnabled: (providerId, modelId, enabled, membership) =>
      configService.setPersonalModelEnabled(providerId, modelId, enabled, membership),
    savePersonalModelDraft: (
      providerId,
      originalModelId,
      nextModelId,
      config,
      expectedPersonalRevision,
      useRecommendedConfig,
      membership,
    ) =>
      configService.savePersonalModelDraft(
        providerId,
        originalModelId,
        nextModelId,
        config,
        expectedPersonalRevision,
        useRecommendedConfig,
        membership,
      ),
    refresh: (reason) => registryService.refresh(reason),
    refreshSources: async (reason) => {
      const sourceResults = await Promise.allSettled([
        configRuntime.refreshZCodeBuiltin({ force: true }),
        accountSource.refresh?.(reason) ?? Promise.resolve(),
      ]);
      const snapshot = await registryService.refresh(reason);
      const failed = sourceResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
      return snapshot;
    },
  };
}

export function createProviderRuntime(options: ProviderRuntimeOptions): ProviderRuntime {
  const { accountSource, testConnectivity, fetchAiProxyCatalog, ...configRuntimeOptions } = options;
  const configRuntime = createProviderConfigRuntime(configRuntimeOptions);
  const modelSelectionConfiguredDefaultSource = new NodeModelSelectionConfigRepository({
    personalRepository: configRuntime.personalRepository,
  });
  return createProviderRuntimeFromConfigRuntime({
    configRuntime,
    accountSource,
    testConnectivity,
    fetchAiProxyCatalog,
    modelSelectionConfiguredDefaultSource,
    disposeModelSelectionConfiguredDefaultSource: () =>
      modelSelectionConfiguredDefaultSource.dispose(),
  });
}

export function createProviderRuntimeFromConfigRuntime(
  dependencies: ProviderRuntimeDependencies,
): ProviderRuntime {
  return new ProviderRuntime(dependencies);
}
