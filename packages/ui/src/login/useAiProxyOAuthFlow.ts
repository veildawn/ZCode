import { useCallback, useEffect, useRef, useState } from "react";
import type { AiProxyOAuthToken } from "@zcode/services";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

/** 网关地址示例，仅用于输入框 placeholder；不作为任何默认值预填。 */
export const AI_PROXY_GATEWAY_BASE_URL_PLACEHOLDER = "https://gateway.example.com";
/** 轮询间隔：网关的同意页是人在点，秒级足够，也不至于让回调后多等。 */
const POLL_INTERVAL_MS = 1_200;
/**
 * 宿主 RPC 的等待上限。宿主进程被杀（例如 dev 下 stdout 管道断开导致 EPIPE）时，
 * 这些调用不会 reject，只会永远挂着；没有这个上限，用户看到的就是"点了没反应"。
 */
const HOST_CALL_TIMEOUT_MS = 15_000;

export type AiProxyOAuthFlowStatus = "idle" | "starting" | "waiting" | "completing" | "error";

export interface AiProxyOAuthFlowController {
  readonly status: AiProxyOAuthFlowStatus;
  readonly errorMessage: string | null;
  /** 已发出请求、浏览器还没回来。 */
  readonly busy: boolean;
  /** 发起授权；等待期间调用等价于重新打开授权页。 */
  start(baseUrl: string): Promise<void>;
  /** 释放回环端口并回到 idle。 */
  cancel(): Promise<void>;
  clearError(): void;
}

/**
 * AI Proxy 网关 OAuth 的客户端状态机：发起授权 → 打开浏览器 → 轮询宿主结果 → 交出令牌。
 *
 * 授权码与令牌都在宿主进程落地，这里只驱动 UI 状态，因此登录页的「OAuth 授权」
 * tab 和设置页供应商卡片上的 OAuth 按钮可以共用同一份流程与取消语义。
 */
export function useAiProxyOAuthFlow(options: {
  /** 拿到令牌之后要做的事（建 Provider / 写 Provider / 同步模型）。抛错回到 error 态。 */
  onToken: (token: AiProxyOAuthToken) => void | Promise<void>;
  /** 日志前缀，便于区分是登录入口还是设置页触发的。 */
  logScope: string;
}): AiProxyOAuthFlowController {
  const { oauthService } = useServices();
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [status, setStatus] = useState<AiProxyOAuthFlowStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const flowIdRef = useRef<string | null>(null);
  const authorizeUrlRef = useRef<string | null>(null);
  const onTokenRef = useRef(options.onToken);
  onTokenRef.current = options.onToken;
  const logScope = options.logScope;
  const hostTimeoutMessage = intl.formatMessage({ id: "login.aiProxy.oauth.hostTimeout" });

  /** 给宿主 RPC 加等待上限：宿主不在了也要把"没反应"变成一条明确的失败。 */
  const callHost = useCallback(
    <T>(operation: Promise<T>): Promise<T> =>
      Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(hostTimeoutMessage)),
            HOST_CALL_TIMEOUT_MS,
          );
          void operation.finally(() => clearTimeout(timer)).catch(() => undefined);
        }),
      ]),
    [hostTimeoutMessage],
  );

  const releaseFlow = useCallback(async () => {
    const flowId = flowIdRef.current;
    flowIdRef.current = null;
    authorizeUrlRef.current = null;
    if (flowId) {
      await oauthService.cancelAiProxyOAuthLogin(flowId);
    }
  }, [oauthService]);

  const start = useCallback(
    async (baseUrl: string) => {
      // 等待期间重新点击只是把授权页再拿到前台：新起一条流程会让上一轮的 state
      // 被用在下一轮的回调上，两边都失败。
      if (flowIdRef.current && authorizeUrlRef.current) {
        platform.openExternal(authorizeUrlRef.current);
        return;
      }
      setStatus("starting");
      setErrorMessage(null);
      try {
        const started = await callHost(oauthService.startAiProxyOAuthLogin(baseUrl));
        flowIdRef.current = started.flowId;
        authorizeUrlRef.current = started.authorizeUrl;
        setStatus("waiting");
        platform.openExternal(started.authorizeUrl);
      } catch (error) {
        logger.error(`[${logScope}] 发起网关 OAuth 失败`, { error });
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [callHost, logScope, oauthService, platform],
  );

  const cancel = useCallback(async () => {
    await releaseFlow();
    setStatus("idle");
    setErrorMessage(null);
  }, [releaseFlow]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setStatus((current) => (current === "error" ? "idle" : current));
  }, []);

  // 组件卸载（离开登录页 / 切走供应商）时必须收回环端口，否则它会一直监听到超时。
  useEffect(() => {
    return () => {
      const flowId = flowIdRef.current;
      flowIdRef.current = null;
      authorizeUrlRef.current = null;
      if (flowId) {
        void oauthService.cancelAiProxyOAuthLogin(flowId);
      }
    };
  }, [oauthService]);

  useEffect(() => {
    if (status !== "waiting") {
      return;
    }
    const flowId = flowIdRef.current;
    if (!flowId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await callHost(oauthService.pollAiProxyOAuthLogin(flowId));
        if (cancelled) {
          return;
        }
        if (!result) {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
          return;
        }
        flowIdRef.current = null;
        authorizeUrlRef.current = null;
        if (result.state === "failed") {
          setStatus("error");
          setErrorMessage(result.error.message);
          return;
        }
        setStatus("completing");
        try {
          await onTokenRef.current(result.token);
          setStatus("idle");
        } catch (error) {
          logger.error(`[${logScope}] 处理网关 OAuth 令牌失败`, { error });
          setStatus("error");
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        logger.error(`[${logScope}] 轮询网关 OAuth 失败`, { error });
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    };
    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [callHost, logScope, oauthService, status]);

  return {
    status,
    errorMessage,
    busy: status === "starting" || status === "completing",
    start,
    cancel,
    clearError,
  };
}

/**
 * 把 Provider 的 API BaseURL（`…/v1`）还原成授权服务器地址（站点根）。
 * 授权服务器挂在站点根：带 `/v1` 去发现文档只会 404。
 */
export function resolveAiProxyGatewayBaseUrl(apiBaseUrl: string): string {
  // 空值不回落默认网关：授权必须打在用户自己填的那个网关上。
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
