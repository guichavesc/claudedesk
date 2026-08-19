import React, { useEffect, useState } from 'react';
import { Loader2, Copy, CheckCircle2 } from 'lucide-react';
import { ProviderId, providerDisplayName } from '../types';

interface NewProfileModalProps {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    authType: string;
    apiKey?: string;
    provider: ProviderId;
  }) => void;
}

type InteractiveAuth = 'subscription' | 'google' | 'chatgpt';

export function NewProfileModal({ onClose, onSubmit }: NewProfileModalProps) {
  const [provider, setProvider] = useState<ProviderId>('claude');
  const [name, setName] = useState('');
  const [authMode, setAuthMode] = useState<'interactive' | 'apikey'>('interactive');
  const [apiKey, setApiKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [authStatus, setAuthStatus] = useState('');
  const [subscriptionVerified, setSubscriptionVerified] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [authCommand, setAuthCommand] = useState('');
  const [cliStatus, setCliStatus] = useState<{
    available: boolean;
    viaNpx?: boolean;
    message?: string;
    installHint?: string;
    checking?: boolean;
  }>({ available: true });

  useEffect(() => {
    setSubscriptionVerified(false);
    setAuthStatus('');
    setApiKey('');
    setAuthMode('interactive');
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (provider === 'claude') {
        setCliStatus({ available: true });
        return;
      }
      setCliStatus({ available: false, checking: true });
      try {
        const status = await window.api.checkProviderCli(provider);
        if (!cancelled) {
          setCliStatus({
            available: status.available,
            viaNpx: status.viaNpx,
            message: status.message,
            installHint: status.installHint,
            checking: false,
          });
        }
      } catch {
        if (!cancelled) {
          setCliStatus({
            available: false,
            message: `${providerDisplayName(provider)} CLI not found`,
            checking: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!name.trim() || !cliStatus.available) {
        setAuthCommand('');
        return;
      }
      try {
        const cmd = await window.api.getProviderAuthCommand(provider, name.trim());
        if (!cancelled) setAuthCommand(cmd);
      } catch {
        if (!cancelled) setAuthCommand('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, name, cliStatus.available]);

  const cliMissing = provider !== 'claude' && !cliStatus.available && !cliStatus.checking;

  const interactiveAuthType = (): InteractiveAuth => {
    if (provider === 'gemini') return 'google';
    if (provider === 'codex') return 'chatgpt';
    return 'subscription';
  };

  const interactiveLabel =
    provider === 'gemini' ? 'Google account' : provider === 'codex' ? 'ChatGPT account' : 'Subscription';

  const apiKeyPlaceholder =
    provider === 'gemini' ? 'AI Studio API key' : provider === 'codex' ? 'sk-...' : 'sk-ant-...';

  const apiKeyHint =
    provider === 'gemini'
      ? 'Get your key from aistudio.google.com'
      : provider === 'codex'
        ? 'Get your key from platform.openai.com'
        : 'Get your API key from console.anthropic.com';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || cliMissing) return;
    if (authMode === 'apikey' && !apiKey) return;

    onSubmit({
      name,
      authType: authMode === 'apikey' ? 'apikey' : interactiveAuthType(),
      apiKey: authMode === 'apikey' ? apiKey : undefined,
      provider,
    });
  };

  const handleCopyCommand = () => {
    if (!authCommand || cliMissing) return;
    navigator.clipboard.writeText(authCommand);
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  };

  const handleVerifyAuth = async () => {
    if (!name || cliMissing) {
      if (cliMissing) {
        alert(cliStatus.message || `${providerDisplayName(provider)} CLI is not installed.`);
      } else {
        alert('Please enter a profile name first');
      }
      return;
    }

    setIsVerifying(true);
    setAuthStatus('Checking for credentials...');

    try {
      const result =
        provider === 'gemini'
          ? await window.api.verifyGeminiAuth(name)
          : provider === 'codex'
            ? await window.api.verifyCodexAuth(name)
            : await window.api.verifyClaudeAuth(name);

      if (result.success) {
        setAuthStatus('');
        setSubscriptionVerified(true);
      } else {
        setAuthStatus('');
        alert(result.message || 'No credentials found. Please run the command in your terminal first.');
      }
    } catch {
      setAuthStatus('');
      alert('Error verifying authentication. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="cd-scrim" onClick={onClose}>
      <div className="cd-dialog w-[460px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-[18px] pb-3.5 border-b-2 border-[var(--strong)] flex flex-col gap-1">
          <h2 className="text-[19px] font-extrabold tracking-tight">New profile</h2>
          <span className="font-mono text-[10.5px] text-[var(--dim)]">Profiles hold auth, quota and MCP servers.</span>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-[18px] flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="cd-kicker">Agent</label>
            <div className="flex border-2 border-[var(--strong)]">
              {(['claude', 'codex', 'gemini'] as ProviderId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProvider(id)}
                  className={`flex-1 px-3 py-2 font-mono text-[11.5px] tracking-wide border-l-2 first:border-l-0 border-[var(--strong)] ${
                    provider === id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--dim)] hover:bg-[var(--tint)] hover:text-[var(--accent)]'
                  }`}
                >
                  {providerDisplayName(id).toUpperCase()}
                </button>
              ))}
            </div>
            {(provider === 'gemini' || provider === 'codex') && !cliMissing && !cliStatus.checking && (
              <p className="text-[11px] text-[var(--color-text-dim)]">
                {cliStatus.viaNpx
                  ? `No global ${providerDisplayName(provider)} install — will use npx (first run may download).`
                  : `${providerDisplayName(provider)} CLI found on PATH.`}
              </p>
            )}
            {cliStatus.checking && (
              <p className="text-[11px] text-[var(--color-text-dim)] flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Checking for {providerDisplayName(provider)} CLI…
              </p>
            )}
            {cliMissing && (
              <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-[12px] text-[var(--color-text-secondary)]">
                <p className="text-red-400 font-medium mb-1">
                  {providerDisplayName(provider)} CLI and npx not found
                </p>
                <p className="mb-2">
                  {cliStatus.message || 'Install Node.js/npm (for npx) or the CLI itself.'}
                </p>
                {cliStatus.installHint && (
                  <pre className="bg-[#1a1a1a] rounded p-2 font-mono text-[11px] text-[var(--color-accent)] whitespace-pre-wrap">
                    {cliStatus.installHint}
                  </pre>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    setCliStatus({ available: false, checking: true });
                    const status = await window.api.checkProviderCli(provider);
                    setCliStatus({
                      available: status.available,
                      viaNpx: status.viaNpx,
                      message: status.message,
                      installHint: status.installHint,
                      checking: false,
                    });
                  }}
                  className="mt-2 text-[11px] text-[var(--color-accent)] hover:brightness-110"
                >
                  Recheck
                </button>
              </div>
            )}
          </div>

          {!cliMissing && (
          <>
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
              Profile Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Profile"
              className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] text-[var(--color-text-primary)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
              Authentication Type
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="authMode"
                  checked={authMode === 'interactive'}
                  onChange={() => setAuthMode('interactive')}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[13px] text-[var(--color-text-primary)]">{interactiveLabel}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="authMode"
                  checked={authMode === 'apikey'}
                  onChange={() => setAuthMode('apikey')}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[13px] text-[var(--color-text-primary)]">API Key</span>
              </label>
            </div>
          </div>

          {authMode === 'interactive' && (
            <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded p-4">
              <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
                Run this command in your terminal to authenticate:
              </p>

              <div className="bg-[#1a1a1a] rounded p-3 mb-3 font-mono text-[11px] flex items-center justify-between gap-2">
                <code className="text-[var(--color-accent)] flex-1 break-all">
                  {authCommand || 'Enter a profile name to see the command'}
                </code>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  disabled={!authCommand}
                  className="shrink-0 p-1.5 hover:bg-[var(--color-bg-hover)] rounded transition-colors disabled:opacity-40"
                  title="Copy command"
                >
                  {commandCopied ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} className="text-[var(--color-text-dim)]" />
                  )}
                </button>
              </div>

              <p className="text-[11px] text-[var(--color-text-dim)] mb-3">
                After completing authentication in your browser, click verify below.
              </p>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleVerifyAuth}
                  disabled={isVerifying || !name}
                  className="w-full px-4 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : subscriptionVerified ? (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Verified!</span>
                    </>
                  ) : (
                    'Verify Authentication'
                  )}
                </button>

                {authStatus && (
                  <div className="text-[12px] text-[var(--color-text-secondary)]">{authStatus}</div>
                )}
              </div>
            </div>
          )}

          {authMode === 'apikey' && (
            <div className="flex flex-col gap-2">
              <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKeyPlaceholder}
                className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors"
              />
              <p className="text-[11px] text-[var(--color-text-dim)]">{apiKeyHint}</p>
            </div>
          )}
          </>
          )}

          <div className="flex justify-end gap-2.5 -mx-5 -mb-[18px] mt-2 px-5 py-3.5 border-t-2 border-[var(--strong)]">
            <button
              type="button"
              onClick={onClose}
              className="cd-btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cd-btn-primary"
              disabled={
                cliMissing ||
                cliStatus.checking ||
                !name ||
                (authMode === 'apikey' && !apiKey) ||
                (authMode === 'interactive' && !subscriptionVerified)
              }
            >
              Create profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
