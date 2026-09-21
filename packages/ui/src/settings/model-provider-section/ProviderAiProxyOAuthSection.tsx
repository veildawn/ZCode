import { ExternalLinkIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AiProxyOAuthFlowStatus } from "@/login/useAiProxyOAuthFlow.js";

/**
 * 设置页供应商卡片上的网关 OAuth 入口：与欢迎页的「OAuth 授权」同一个宿主流程，
 * 区别只是令牌落到**已存在的**这个 Provider 上，而不是新建一个。
 */
export function ProviderAiProxyOAuthSection({
  status,
  errorMessage,
  onStart,
  onCancel,
  disabled = false,
}: {
  status: AiProxyOAuthFlowStatus;
  errorMessage: string | null;
  onStart: () => void;
  onCancel: () => void;
  /** 还没有网关地址时禁用入口：授权必须打在用户填的那个网关上。 */
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const waiting = status === "waiting";
  const busy = status === "starting" || status === "completing";
  const showCancel = waiting || busy;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.modelProvider.aiProxyOAuth.title" })}
      </div>
      <p className="text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "settings.modelProvider.aiProxyOAuth.description" })}
      </p>

      {waiting ? (
        <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
          {intl.formatMessage({ id: "settings.modelProvider.aiProxyOAuth.waiting" })}
        </div>
      ) : null}

      {status === "completing" ? (
        <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
          {intl.formatMessage({ id: "settings.modelProvider.aiProxyOAuth.completing" })}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="flex items-start gap-2 text-ui-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{errorMessage}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="model-provider-ai-proxy-oauth-start"
          disabled={busy || disabled}
          onClick={onStart}
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <ExternalLinkIcon className="size-3.5" />
          )}
          {intl.formatMessage({
            id: waiting
              ? "settings.modelProvider.aiProxyOAuth.reopen"
              : "settings.modelProvider.aiProxyOAuth.start",
          })}
        </Button>
        {showCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={status === "completing"}
            onClick={onCancel}
          >
            {intl.formatMessage({ id: "settings.modelProvider.aiProxyOAuth.cancel" })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
