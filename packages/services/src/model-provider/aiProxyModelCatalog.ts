/**
 * AI Proxy 网关模型目录 → ZCode 模型配置的映射。
 *
 * 网关的 `GET /v1/models` 是它自己对"这个 id 会怎么被服务"的回答：上下文窗口、
 * 思考档位、输入模态、端点面（modality）。这里只做翻译，不发请求，也不写配置——
 * 网络与落盘分别由宿主侧的 catalog 取数与 Provider Settings 的替换事务负责。
 *
 * 放在 services 根入口（browser-safe）：它只消费类型与纯函数，Renderer 侧的
 * 登录流程与宿主侧的启动同步共用同一份映射，避免两边对同一份网关数据给出不同配置。
 */
import type { ModelConfigObject } from "@zcode/provider";

export interface AiProxyCatalogEntry {
  readonly id: string;
  readonly contextWindow: number | null;
  /** 网关发布的单模型输出上限；当前网关不发布，缺失时按下文的窗口回落。 */
  readonly maxOutputTokens: number | null;
  /** 网关给出的思考档位；空数组是"明确没有思考档位"，null 是"网关没说"。 */
  readonly effortLevels: readonly string[] | null;
  readonly inputModalities: readonly string[];
  /** 网关自己声明的服务面（chat / image / …）；缺失表示网关没有回答。 */
  readonly modality: string | null;
}

/**
 * OpenAI 兼容 chat 请求的思考档位字段。网关把 `reasoning_effort` 当通用思考旋钮，
 * 再按上游协议翻译；客户端只说"要哪一档"，不说"翻译成什么"。
 */
const REASONING_EFFORT_MAP = '{"reasoning_effort": reasoningLevel}';

/**
 * 输出上限的请求字段。网关把 chat 面的输出上限拼成 `max_tokens`
 * （responses 面才是 `max_output_tokens`，由网关自己翻译），这里只说客户端看到的字段。
 */
const MAX_OUTPUT_TOKENS_MAP = '{"max_tokens": maxOutputTokens}';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => asTrimmedString(item)).filter((item): item is string => item !== null);
}

/**
 * 解析 `/v1/models` 响应。兼容 `{data: []}`（OpenAI 形状）与 `{models: []}`
 * （网关早期形状）；解不出来的条目直接跳过而不是伪造字段。
 */
export function readAiProxyCatalog(document: unknown): AiProxyCatalogEntry[] {
  const root = asRecord(document);
  if (!root) return [];
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : [];
  const entries: AiProxyCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    const id = record ? asTrimmedString(record.id) : null;
    if (!record || !id || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      contextWindow: asPositiveInt(record.context_window),
      maxOutputTokens: asPositiveInt(record.max_output_tokens),
      effortLevels: asStringArray(record.effort_levels),
      inputModalities: asStringArray(record.input_modalities) ?? [],
      modality: asTrimmedString(record.modality),
    });
  }
  return entries;
}

/**
 * 目录里能进 ZCode 模型列表的只有 chat 面。
 *
 * 网关的 `modality` 说的是"这个 id 由哪个端点服务"，chat 面的取值是 `text`
 * （见网关 internal/modality）；`image` / `embedding` 这类 id 走别的端点，
 * 放进模型选择器只会得到一次必然失败的请求。缺失该字段表示网关没回答，按 chat 放行。
 */
export function isAiProxyChatModel(entry: AiProxyCatalogEntry): boolean {
  return entry.modality === null || entry.modality === "text" || entry.modality === "chat";
}

function buildInputFormat(modalities: readonly string[]): ModelConfigObject["properties"] {
  const has = (name: string): boolean => modalities.includes(name);
  return {
    inputFormat: {
      supportsText: modalities.length === 0 || has("text"),
      supportsImage: has("image"),
      supportsVideo: has("video"),
      supportsAudio: has("audio"),
      supportsPdf: has("pdf"),
    },
  };
}

/**
 * 一条网关目录项 → 一条 ZCode 模型配置。
 *
 * 只写网关能证明的字段：上下文窗口、输入模态、思考档位、JSON Schema 输出
 * （网关按请求体转协议，结构化输出在它这一层就是可用的）。其余能力（工具调用、
 * 输出格式、system 中插话）继续走内置模型规则给的默认值，不在这里重复声明。
 */
export function buildAiProxyModelConfig(entry: AiProxyCatalogEntry): ModelConfigObject {
  const properties: NonNullable<ModelConfigObject["properties"]> = {
    ...buildInputFormat(entry.inputModalities),
    supportsJsonSchemaOutput: true,
  };
  if (entry.contextWindow !== null) {
    properties.contextWindow = entry.contextWindow;
  }
  const config: {
    enabled: boolean;
    properties: NonNullable<ModelConfigObject["properties"]>;
    optionSpecs?: NonNullable<ModelConfigObject["optionSpecs"]>;
  } = { enabled: true, properties };
  const optionSpecs: NonNullable<ModelConfigObject["optionSpecs"]> = {};
  if (entry.effortLevels !== null) {
    // 空档位是"网关明确说这个模型没有思考档位"，用 null 表达"不提供该选项"，
    // 而不是留空继承别的模型（尤其是智谱）的档位。
    optionSpecs.reasoningLevel =
      entry.effortLevels.length === 0
        ? null
        : { values: [...entry.effortLevels], map: REASONING_EFFORT_MAP };
  }
  // 网关不发布单模型的 vendor 输出上限，而 ZCode 的每一步请求都必须带一个输出预算
  // （resolveNormalRequestMaxOutputTokens 直接取这个 max）。给不出更细的事实时就以窗口为上界：
  // 模型不可能输出超过自己窗口的内容，网关与上游再按真实上限裁剪。
  const maxOutputTokens = entry.maxOutputTokens ?? entry.contextWindow;
  if (maxOutputTokens !== null) {
    optionSpecs.maxOutputTokens = { max: maxOutputTokens, map: MAX_OUTPUT_TOKENS_MAP };
  }
  if (Object.keys(optionSpecs).length > 0) {
    config.optionSpecs = optionSpecs;
  }
  return config;
}
