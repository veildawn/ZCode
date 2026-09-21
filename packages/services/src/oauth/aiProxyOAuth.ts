/**
 * AI Proxy 网关的客户端 OAuth 登录：授权码 + PKCE(S256) + 127.0.0.1 回环回调。
 *
 * 这里的授权服务器是网关自己，不是智谱账号：客户端拿到的推理凭据由网关签发，
 * 额度和模型权限与静态 API Key 共用同一套 entitlement。协议细节见网关仓库
 * docs/clients/oauth-login.md——发现文档、统一 public client、强制 S256、
 * 回环回调只接受 IP literal，都是那份文档定下的规则。
 *
 * 回环监听放在宿主进程而不是 renderer：浏览器授权页可以由 renderer 打开，但
 * 授权码只能在宿主侧收（renderer 不能监听端口），令牌兑换也顺带避开了 CORS。
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

/** 公共客户端 id；网关对未注册的 client_id 给最小能力集（回环 + 粘贴码 + scope api）。 */
export const AI_PROXY_OAUTH_CLIENT_ID = "zcode-desktop";
/** 回环回调路径；回调主机必须是 IP literal，`localhost` 会被网关拒绝。 */
export const AI_PROXY_OAUTH_CALLBACK_PATH = "/oauth/callback";

const LOOPBACK_HOST = "127.0.0.1";
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
/** 网关只授予 scope api；请求别的值会被授权端点直接拒绝。 */
const OAUTH_SCOPE = "api";
/**
 * 网关允许客户端申请更长的令牌租期（硬上限 366 天）。宿主把访问令牌当静态凭据
 * 写进 Provider 配置，没有刷新通道，所以按一年申请；不支持该参数的网关会忽略它，
 * 回落默认的一小时租期。
 */
const REQUESTED_ACCESS_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface AiProxyOAuthStartResponse {
  readonly flowId: string;
  readonly authorizeUrl: string;
  readonly redirectUri: string;
}

export interface AiProxyOAuthToken {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresInSeconds: number | null;
  readonly scope: string | null;
}

export type AiProxyOAuthFailureCode =
  | "authorization-denied"
  | "state-mismatch"
  | "missing-code"
  | "timeout"
  | "token-exchange-failed"
  | "unknown-flow";

export interface AiProxyOAuthFailure {
  readonly code: AiProxyOAuthFailureCode;
  readonly message: string;
}

export type AiProxyOAuthPollResult =
  | { readonly state: "completed"; readonly token: AiProxyOAuthToken }
  | { readonly state: "failed"; readonly error: AiProxyOAuthFailure };

export interface AiProxyOAuthFlowOptions {
  /** 走宿主网络栈（代理、企业 CA）时由调用方注入。 */
  readonly request?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

interface GatewayMetadata {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

interface PendingFlow {
  readonly flowId: string;
  readonly baseUrl: string;
  readonly metadata: GatewayMetadata;
  readonly verifier: string;
  readonly state: string;
  readonly redirectUri: string;
  readonly server: Server;
  readonly timer: NodeJS.Timeout;
  code: string | null;
  failure: AiProxyOAuthFailure | null;
  exchanging: boolean;
}

const defaultRequest = (input: string | URL, init?: RequestInit): Promise<Response> =>
  fetch(input, init);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 规范化网关地址：允许省略协议，去掉查询/哈希与末尾斜杠，保留子路径前缀
 * （自建网关可能挂在 `/gateway` 这类前缀下，发现文档与 API 都要跟着它）。
 */
export function normalizeAiProxyBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("网关地址不能为空");
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("网关地址不是合法的 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("网关地址必须使用 http/https");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** 网关推理前缀：Provider 的 baseUrl 是 `/v1`，授权服务器则在站点根。 */
export function buildAiProxyApiBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

function readEndpoint(document: unknown, key: "authorization_endpoint" | "token_endpoint"): string {
  if (typeof document === "object" && document !== null) {
    const value = (document as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(`网关发现文档缺少 ${key}`);
}

function readField(payload: unknown, key: string): unknown {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function renderCallbackPage(input: { ok: boolean; message: string }): string {
  const title = input.ok ? "授权完成" : "授权失败";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<title>${title}</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"PingFang SC",sans-serif;background:#0b0b0c;color:#f5f5f5}
main{max-width:24rem;padding:2rem;text-align:center}code{color:#a1a1aa}</style></head>
<body><main><h1>${title}</h1><p>${input.message}</p>
<p><code>可以关闭此页面并返回 ZCode</code></p></main></body></html>`;
}

/**
 * 单流程的 AI Proxy OAuth 登录状态机：`start` 绑定回环端口并给出授权地址，
 * `poll` 在浏览器回调到达后兑换令牌，`cancel` 随时释放端口。
 *
 * 同时只保留一个流程：用户重新发起登录时旧流程连同它的端口一起作废。
 */
export class AiProxyOAuthFlow {
  readonly #request: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly #timeoutMs: number;
  #flow: PendingFlow | null = null;

  constructor(options: AiProxyOAuthFlowOptions = {}) {
    this.#request = options.request ?? defaultRequest;
    this.#timeoutMs = options.timeoutMs ?? FLOW_TIMEOUT_MS;
  }

  async start(rawBaseUrl: string): Promise<AiProxyOAuthStartResponse> {
    this.cancel();
    const baseUrl = normalizeAiProxyBaseUrl(rawBaseUrl);
    const metadata = await this.#discover(baseUrl);

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("hex");
    const flowId = randomBytes(16).toString("hex");
    const { server, redirectUri } = await this.#listen(flowId);
    const flow: PendingFlow = {
      flowId,
      baseUrl,
      metadata,
      verifier,
      state,
      redirectUri,
      server,
      // 超时也要收口：端口、流程一起释放，UI 下一次轮询就能看到失败原因。
      timer: setTimeout(() => {
        this.#fail(flow, { code: "timeout", message: "授权等待超时，请重新发起登录" });
      }, this.#timeoutMs),
      code: null,
      failure: null,
      exchanging: false,
    };
    this.#flow = flow;

    const authorizeUrl = new URL(metadata.authorizationEndpoint);
    authorizeUrl.searchParams.set("client_id", AI_PROXY_OAUTH_CLIENT_ID);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", OAUTH_SCOPE);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    return { flowId, authorizeUrl: authorizeUrl.toString(), redirectUri };
  }

  async poll(flowId: string): Promise<AiProxyOAuthPollResult | null> {
    const flow = this.#flow;
    if (!flow || flow.flowId !== flowId) {
      return {
        state: "failed",
        error: { code: "unknown-flow", message: "登录流程已失效，请重新发起" },
      };
    }
    if (flow.exchanging) {
      return null;
    }
    if (flow.failure) {
      const error = flow.failure;
      this.#release(flow);
      return { state: "failed", error };
    }
    const code = flow.code;
    if (!code) {
      return null;
    }
    flow.code = null;
    flow.exchanging = true;
    try {
      const token = await this.#exchangeCode(flow, code);
      this.#release(flow);
      return { state: "completed", token };
    } catch (error) {
      this.#release(flow);
      return {
        state: "failed",
        error: { code: "token-exchange-failed", message: describeError(error) },
      };
    }
  }

  cancel(flowId?: string): void {
    const flow = this.#flow;
    if (!flow || (flowId && flow.flowId !== flowId)) {
      return;
    }
    this.#release(flow);
  }

  dispose(): void {
    this.cancel();
  }

  async #discover(baseUrl: string): Promise<GatewayMetadata> {
    const discoveryUrl = `${baseUrl}/.well-known/oauth-authorization-server`;
    let response: Response;
    try {
      response = await this.#request(discoveryUrl, { headers: { accept: "application/json" } });
    } catch (error) {
      throw new Error(`无法连接网关 ${baseUrl}：${describeError(error)}`);
    }
    if (!response.ok) {
      throw new Error(`网关发现文档不可用（HTTP ${response.status}）`);
    }
    let document: unknown;
    try {
      document = await response.json();
    } catch {
      throw new Error("网关发现文档不是合法 JSON");
    }
    return {
      authorizationEndpoint: readEndpoint(document, "authorization_endpoint"),
      tokenEndpoint: readEndpoint(document, "token_endpoint"),
    };
  }

  async #listen(flowId: string): Promise<{ server: Server; redirectUri: string }> {
    const server = createServer((request, response) => {
      this.#handleCallback(flowId, request.url ?? "/", response);
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, LOOPBACK_HOST);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("回环回调端口绑定失败");
    }
    return {
      server,
      redirectUri: `http://${LOOPBACK_HOST}:${address.port}${AI_PROXY_OAUTH_CALLBACK_PATH}`,
    };
  }

  #handleCallback(flowId: string, rawUrl: string, response: ServerResponse): void {
    const flow = this.#flow;
    if (!flow || flow.flowId !== flowId) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const url = new URL(rawUrl, `http://${LOOPBACK_HOST}`);
    if (url.pathname !== AI_PROXY_OAUTH_CALLBACK_PATH) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const respond = (ok: boolean, status: number, message: string): void => {
      response.statusCode = status;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(renderCallbackPage({ ok, message }));
    };

    const denyReason = url.searchParams.get("error");
    if (url.searchParams.get("state") !== flow.state) {
      // 回调地址是回环明文 http，任何人都能往里发请求；state 是唯一能证明
      // "这条回调属于本次登录"的东西，不匹配就整条流程作废。
      respond(false, 400, "回调 state 与本次登录不匹配，已忽略该回调。");
      this.#fail(flow, { code: "state-mismatch", message: "回调 state 校验失败" });
      return;
    }
    if (denyReason) {
      respond(false, 400, "网关没有批准本次授权。");
      this.#fail(flow, { code: "authorization-denied", message: `网关拒绝了授权：${denyReason}` });
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      respond(false, 400, "回调没有携带授权码。");
      this.#fail(flow, { code: "missing-code", message: "回调没有携带授权码" });
      return;
    }
    flow.code = code;
    // 端口只服务这一次回调：拿到码就关，不留长期监听。
    flow.server.close();
    respond(true, 200, "ZCode 已收到授权码，正在完成登录。");
  }

  async #exchangeCode(flow: PendingFlow, code: string): Promise<AiProxyOAuthToken> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
      client_id: AI_PROXY_OAUTH_CLIENT_ID,
      code_verifier: flow.verifier,
      access_token_ttl_seconds: String(REQUESTED_ACCESS_TOKEN_TTL_SECONDS),
    });
    const response = await this.#request(flow.metadata.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        asTrimmedString(readField(payload, "error_description")) ??
          asTrimmedString(readField(payload, "error")) ??
          `令牌端点返回 HTTP ${response.status}`,
      );
    }
    const accessToken = asTrimmedString(readField(payload, "access_token"));
    if (!accessToken) {
      throw new Error("网关响应缺少 access_token");
    }
    return {
      baseUrl: flow.baseUrl,
      accessToken,
      refreshToken: asTrimmedString(readField(payload, "refresh_token")),
      expiresInSeconds: asFiniteNumber(readField(payload, "expires_in")),
      scope: asTrimmedString(readField(payload, "scope")),
    };
  }

  #fail(flow: PendingFlow, error: AiProxyOAuthFailure): void {
    if (flow.failure || flow.code) {
      return;
    }
    flow.failure = error;
    flow.server.close();
  }

  #release(flow: PendingFlow): void {
    if (this.#flow === flow) {
      this.#flow = null;
    }
    clearTimeout(flow.timer);
    if (flow.server.listening) {
      flow.server.close();
    }
  }
}
