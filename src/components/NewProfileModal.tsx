import React, { useState } from 'react';
import { Loader2, Copy, CheckCircle2 } from 'lucide-react';

interface NewProfileModalProps {
  onClose: () => void;
  onSubmit: (data: { name: string; authType: 'subscription' | 'apikey'; apiKey?: string }) => void;
}

export function NewProfileModal({ onClose, onSubmit }: NewProfileModalProps) {
  const [name, setName] = useState('');
  const [authType, setAuthType] = useState<'subscription' | 'apikey'>('subscription');
  const [apiKey, setApiKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [authStatus, setAuthStatus] = useState('');
  const [subscriptionVerified, setSubscriptionVerified] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    if (authType === 'apikey' && !apiKey) return;
    
    onSubmit({ 
      name, 
      authType, 
      apiKey: authType === 'apikey' ? apiKey : undefined 
    });
  };

  const authCommand = `CLAUDE_CONFIG_DIR=~/.claude-profiles/${name} npx claude`;

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(authCommand);
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  };

  const handleVerifyAuth = async () => {
    if (!name) {
      alert('Please enter a profile name first');
      return;
    }

    setIsVerifying(true);
    setAuthStatus('Checking for credentials...');

    try {
      const result = await window.api.verifyClaudeAuth(name);
      
      if (result.success) {
        setAuthStatus('');
        setSubscriptionVerified(true);
      } else {
        setAuthStatus('');
        alert(result.message || 'No credentials found. Please run the command in your terminal first.');
      }
    } catch (error) {
      setAuthStatus('');
      alert('Error verifying authentication. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-[100] flex items-center justify-center">
      <div className="w-[480px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl p-6">
        <h2 className="text-[18px] text-[var(--color-text-primary)] font-semibold mb-6">New Profile</h2>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Profile Name</label>
            <input 
              autoFocus
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="My Profile"
              className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] text-[var(--color-text-primary)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Authentication Type</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="authType" 
                  value="subscription"
                  checked={authType === 'subscription'}
                  onChange={() => setAuthType('subscription')}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[13px] text-[var(--color-text-primary)]">Subscription</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="authType" 
                  value="apikey"
                  checked={authType === 'apikey'}
                  onChange={() => setAuthType('apikey')}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[13px] text-[var(--color-text-primary)]">API Key</span>
              </label>
            </div>
          </div>

          {authType === 'subscription' && (
            <div className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded p-4">
              <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">
                Run this command in your terminal to authenticate:
              </p>
              
              <div className="bg-[#1a1a1a] rounded p-3 mb-3 font-mono text-[11px] flex items-center justify-between gap-2">
                <code className="text-[var(--color-accent)] flex-1 break-all">{authCommand}</code>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="shrink-0 p-1.5 hover:bg-[var(--color-bg-hover)] rounded transition-colors"
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
                After running the command and completing authentication in your browser, click verify below.
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
                  <div className="text-[12px] text-[var(--color-text-secondary)]">
                    {authStatus}
                  </div>
                )}
              </div>
            </div>
          )}

          {authType === 'apikey' && (
            <div className="flex flex-col gap-2">
              <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">API Key</label>
              <input 
                type="password" 
                value={apiKey} 
                onChange={e => setApiKey(e.target.value)} 
                placeholder="sk-ant-..."
                className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors"
              />
              <p className="text-[11px] text-[var(--color-text-dim)]">
                Get your API key from console.anthropic.com
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
              Cancel
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!name || (authType === 'apikey' && !apiKey) || (authType === 'subscription' && !subscriptionVerified)}
            >
              Create Profile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
