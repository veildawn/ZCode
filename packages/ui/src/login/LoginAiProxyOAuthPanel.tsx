import { useCallback, useState } from "react";
import { BUILTIN_PROVIDER_TEMPLATE_IDS } from "@zcode/shared";
import type { AiProxyOAuthToken } from "@zcode/services";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { renderOAuthProviderIcon } from "@/lib/oauthProviderIcon.js";
import { buildLoginApiKeyDefaultModelPreferenceFromSelection } from "@/login/LoginApiKeyForm.helpers.js";
import {
  AI_PROXY_GATEWAY_BASE_URL_PLACEHOLDER,
  useAiProxyOAuthFlow,
} from "@/login/useAiProxyOAuthFlow.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

interface LoginAiProxyOAuthPanelProps {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

function buildApiBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

/**
 * AI Proxy 网关 OAuth 登录面板：宿主侧走授权码 + PKCE 并监听回环回调，
 * 这里只负责打开浏览器、轮询结果，以及把拿到的令牌落成 Provider 凭据。
 */
export function LoginAiProxyOAuthPanel({ onCancel, onSaved }: LoginAiProxyOAuthPanelProps) {
  const { intl } = useZCodeIntl();
  const { modelSelectionService, providerSettingsService } = useServices();
  const markApiKeyLoginSuccess = useZCodeStore((state) => state.markApiKeyLoginSuccess);
  // 网关地址由用户自己填：不同部署的网关地址不同，预填任何一个都会把人带到别人的网关上。
  const [baseUrl, setBaseUrl] = useState("");

  const finishLogin = useCallback(
    async (token: AiProxyOAuthToken) => {
      const created = await providerSettingsService.createPersonalProvider({
        templateId: BUILTIN_PROVIDER_TEMPLATE_IDS.aiProxy,
        // 网关签发的令牌就是 Bearer 凭据，写进与 API Key 同一个字段；
        // access 类型沿用 api-key，避免在 Provider Schema 里新增只服务网关的枚举。
        initialConfig: {
          access: { type: "api-key", apiKey: token.accessToken },
          api: { type: "openai-chat-completions", baseUrl: buildApiBaseUrl(token.baseUrl) },
        } as any,
      });
      // 登录成功即把网关当前的模型目录与参数落到本地：默认模型取目录里的第一个，
      // 网关顺序就是它自己的优先级。同步失败时退回内置模板给出的默认值，登录本身不失败。
      let defaultModelPreference: string | null = null;
      try {
        const synced = await providerSettingsService.syncAiProxyModels(created.providerId);
        const firstModelId = synced.modelIds[0];
        defaultModelPreference = firstModelId
          ? encodeCustomModelValue(created.providerId, firstModelId)
          : null;
      } catch (syncError) {
        logger.warn("[LoginAiProxy] 同步网关模型目录失败", { syncError });
      }
      if (!defaultModelPreference) {
        defaultModelPreference = buildLoginApiKeyDefaultModelPreferenceFromSelection(
          await modelSelectionService.getView(),
          created.providerId,
        );
      }
      markApiKeyLoginSuccess(defaultModelPreference);
      await onSaved();
    },
    [markApiKeyLoginSuccess, modelSelectionService, onSaved, providerSettingsService],
  );

  const flow = useAiProxyOAuthFlow({ onToken: finishLogin, logScope: "LoginAiProxy" });
  const busy = flow.busy;
  const waiting = flow.status === "waiting";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {renderOAuthProviderIcon("ai-proxy" as any, "size-4")}
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.aiProxy.oauth.title" })}
        </h2>
      </div>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "login.aiProxy.oauth.description" })}
      </p>

      <div className="space-y-1.5">
        <label className="text-ui-xs text-muted-foreground" htmlFor="login-ai-proxy-oauth-base-url">
          {intl.formatMessage({ id: "login.aiProxy.oauth.baseUrl" })}
        </label>
        <Input
          id="login-ai-proxy-oauth-base-url"
          type="text"
          size="lg"
          className="h-10 w-full text-ui-base"
          value={baseUrl}
          placeholder={AI_PROXY_GATEWAY_BASE_URL_PLACEHOLDER}
          disabled={busy || waiting}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            flow.clearError();
          }}
        />
      </div>

      {waiting ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-ui-sm text-foreground-subtle">
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
          {intl.formatMessage({ id: "login.aiProxy.oauth.waiting" })}
        </div>
      ) : null}

      {flow.status === "completing" ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-ui-sm text-foreground-subtle">
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
          {intl.formatMessage({ id: "login.aiProxy.oauth.completing" })}
        </div>
      ) : null}

      {flow.errorMessage ? (
        <Alert variant="destructive">
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{flow.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid="login-ai-proxy-oauth-start"
          disabled={busy || !baseUrl.trim()}
          onClick={() => {
            void flow.start(baseUrl);
          }}
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({
            id: waiting ? "login.aiProxy.oauth.reopen" : "login.aiProxy.oauth.start",
          })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          disabled={busy}
          onClick={() => {
            void flow.cancel().then(() => {
              onCancel();
            });
          }}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
      </div>
    </div>
  );
}
