import { useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { renderOAuthProviderIcon } from "@/lib/oauthProviderIcon.js";
import { LoginAiProxyOAuthPanel } from "@/login/LoginAiProxyOAuthPanel.js";
import { LoginApiKeyForm } from "@/login/LoginApiKeyForm.js";

interface LoginAiProxyFormProps {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onSkipped: () => void | Promise<void>;
}

type AiProxyLoginMode = "apiKey" | "oauth";

/**
 * 欢迎页 AI Proxy 网关入口的登录面板：一个入口，两种接入方式。
 *
 * API Key 与 OAuth 授权最终都落成同一种 Provider 凭据（网关的 Bearer 令牌），
 * 差别只在令牌从哪来：用户自己粘贴，还是浏览器授权后由宿主兑换。
 */
export function LoginAiProxyForm({ onCancel, onSaved, onSkipped }: LoginAiProxyFormProps) {
  const { intl } = useZCodeIntl();
  // 网关接入默认走 OAuth：浏览器授权一次即可，不用先找管理员要静态密钥。
  // 需要贴 aps_ 密钥的用户切到 API Key 选项卡即可，两条路径写的是同一份凭据。
  const [mode, setMode] = useState<AiProxyLoginMode>("oauth");

  const tabs: ReadonlyArray<{ id: AiProxyLoginMode; labelId: string }> = [
    { id: "oauth", labelId: "login.aiProxy.tab.oauth" },
    { id: "apiKey", labelId: "login.aiProxy.tab.apiKey" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {renderOAuthProviderIcon("ai-proxy" as any, "size-5")}
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.aiProxy.title" })}
        </h2>
      </div>

      <div
        role="tablist"
        aria-label={intl.formatMessage({ id: "login.aiProxy.title" })}
        className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === mode;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`login-ai-proxy-tab-${tab.id}`}
              className={`h-8 rounded-md text-ui-sm transition-colors ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground-subtle hover:text-foreground"
              }`}
              onClick={() => setMode(tab.id)}
            >
              {intl.formatMessage({ id: tab.labelId })}
            </button>
          );
        })}
      </div>

      {mode === "apiKey" ? (
        <LoginApiKeyForm
          lockedProviderChoice="ai-proxy"
          hideTitle
          onCancel={onCancel}
          onSaved={onSaved}
          onSkipped={onSkipped}
        />
      ) : (
        <LoginAiProxyOAuthPanel onCancel={onCancel} onSaved={onSaved} />
      )}
    </div>
  );
}
