import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Session, Profile, PermissionMode, PERMISSION_MODES, SessionTokenUsage, formatTokenCount, providerDisplayName, profileProvider } from '../types';
import { TerminalView, TerminalViewHandle } from './TerminalView';
import { SessionHeader } from './SessionHeader';
import { TransferSessionModal } from './TransferSessionModal';
import { readBool, OFFER_PROFILE_ON_LIMIT_KEY } from '../lib/appearance';

interface ChatAreaProps {
  session: Session;
  profile?: Profile;
  profiles: Profile[];
  isGitPanelOpen: boolean;
  onToggleGitPanel: () => void;
  onSessionTransferred: (newSessionId: string) => void;
}

export function ChatArea({ session, profile, profiles, isGitPanelOpen, onToggleGitPanel, onSessionTransferred }: ChatAreaProps) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(session.permission_mode || 'default');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [limitDetected, setLimitDetected] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferReason, setTransferReason] = useState<'limit' | 'manual'>('manual');
  const termRef = useRef<TerminalViewHandle>(null);

  useEffect(() => {
    setPermissionMode(session.permission_mode || 'default');
    setIsConnected(true);
    setTokenUsage(null);
    setLimitDetected(false);

    let pendingChunks: string[] = [];
    let backfilled = false;

    // Buffer live chunks until the historical snapshot has been written, so
    // output always renders in the correct order.
    const unsubscribeOutput = window.api.onPtyOutput((sessionId, data) => {
      if (sessionId !== session.id) return;
      if (!backfilled) {
        pendingChunks.push(data);
      } else {
        termRef.current?.write(data);
      }
    });

    const unsubscribeExit = window.api.onPtyExit((sessionId) => {
      if (sessionId !== session.id) return;
      setIsConnected(false);
    });

    const unsubscribeLimit = window.api.onSessionLimitDetected((sessionId) => {
      if (sessionId !== session.id) return;
      if (readBool(OFFER_PROFILE_ON_LIMIT_KEY, true)) setLimitDetected(true);
    });

    (async () => {
      // Paint the last saved transcript immediately so reopen isn't a blank screen
      // while Claude Code boots / resumes the underlying conversation.
      const snapshot = await window.api.getTerminalSnapshot(session.id);
      termRef.current?.clear();
      if (snapshot) termRef.current?.write(snapshot);

      const { cols, rows } = termRef.current?.getSize() || { cols: 80, rows: 30 };
      const startResult = await window.api.startCliSession(session.id, cols, rows);

      // Only show the restore banner when we actually (re)spawned Claude — not when
      // switching back to a tab whose PTY is still alive.
      if (snapshot && !startResult?.alreadyRunning) {
        termRef.current?.write('\r\n\x1b[2m--- reopening session — restoring conversation ---\x1b[0m\r\n\r\n');
      }

      backfilled = true;
      for (const chunk of pendingChunks) termRef.current?.write(chunk);
      pendingChunks = [];

      termRef.current?.focus();
    })();

    return () => {
      unsubscribeOutput();
      unsubscribeExit();
      unsubscribeLimit();
    };
  }, [session.id]);

  useEffect(() => {
    const openMigrate = () => {
      setTransferReason('manual');
      setShowTransfer(true);
    };
    document.addEventListener('claudedesk:migrate', openMigrate);
    return () => document.removeEventListener('claudedesk:migrate', openMigrate);
  }, [session.id]);

  // Poll Claude Code's JSONL transcript for token spend while this tab is open.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const usage = await window.api.getSessionTokenUsage(session.id);
        if (!cancelled) setTokenUsage(usage);
      } catch {
        // ignore — transcript may not exist yet for brand-new sessions
      }
    };
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session.id]);

  const handleResize = (cols: number, rows: number) => {
    window.api.resizeCliSession(session.id, cols, rows);
  };

  // Every keystroke typed while the terminal is focused is forwarded here raw —
  // this is a real interactive terminal, not a line-based chat input.
  const handleData = (data: string) => {
    window.api.sendCliInput(session.id, data);
  };

  const handleModeChange = async (mode: PermissionMode) => {
    setIsModeMenuOpen(false);
    if (mode === permissionMode) return;

    setPermissionMode(mode);
    await window.api.updateSessionMode(session.id, mode);

    setIsRestarting(true);
    termRef.current?.write(`\r\n\x1b[2m--- restarting session in "${PERMISSION_MODES.find(m => m.value === mode)?.label}" mode ---\x1b[0m\r\n\r\n`);
    const { cols, rows } = termRef.current?.getSize() || { cols: 80, rows: 30 };
    await window.api.restartCliSession(session.id, cols, rows);
    setIsConnected(true);
    setIsRestarting(false);
    termRef.current?.focus();
  };

  const handleReconnect = async () => {
    setIsRestarting(true);
    const { cols, rows } = termRef.current?.getSize() || { cols: 80, rows: 30 };
    await window.api.restartCliSession(session.id, cols, rows);
    setIsConnected(true);
    setIsRestarting(false);
    termRef.current?.focus();
  };

  const handleExportSummary = async () => {
    if (isExportingSummary) return;
    setIsExportingSummary(true);
    try {
      const result = await window.api.exportSessionSummary(session.id);
      if (!result.success && result.message && result.message !== 'Export cancelled') {
        alert(result.message);
      }
    } catch (e) {
      alert('Failed to generate session summary');
    } finally {
      setIsExportingSummary(false);
    }
  };

  const hasTokens = !!tokenUsage?.found;
  const tokenTitle = hasTokens
    ? [
        `Input: ${tokenUsage!.inputTokens.toLocaleString()}`,
        `Output: ${tokenUsage!.outputTokens.toLocaleString()}`,
        `Cache read: ${tokenUsage!.cacheReadTokens.toLocaleString()}`,
        `Cache write: ${tokenUsage!.cacheCreateTokens.toLocaleString()}`,
        `${tokenUsage!.requestCount} API request${tokenUsage!.requestCount === 1 ? '' : 's'}`,
      ].join('\n')
    : 'Token usage will appear once Claude responds';

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[var(--bg)]">
      <SessionHeader
        session={session}
        profile={profile}
        isGitPanelOpen={isGitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
        onMigrate={() => {
          setTransferReason('manual');
          setShowTransfer(true);
        }}
      />

      {limitDetected && (
        <div className="flex items-center gap-3.5 px-4 py-2.5 bg-[var(--tint)] border-b border-[var(--accent)]">
          <span className="w-2 h-2 bg-[var(--accent)] shrink-0" />
          <span className="font-mono text-[11.5px] text-[var(--text)]">
            Usage limit reached on <b>{profile?.name || providerDisplayName(session.provider || profileProvider(profile))}</b>
            {session.provider || profile ? ` · ${providerDisplayName(session.provider || profileProvider(profile))}` : ''}.
          </span>
          <div className="ml-auto flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLimitDetected(false)}
              className="cd-btn-ghost py-1.5 px-2.5"
            >
              DISMISS
            </button>
            <button
              type="button"
              onClick={() => {
                setTransferReason('limit');
                setShowTransfer(true);
              }}
              className="cd-btn-primary py-1.5 px-3"
            >
              CONTINUE ON ANOTHER PROFILE
            </button>
          </div>
        </div>
      )}

      <TerminalView ref={termRef} onResize={handleResize} onData={handleData} />

      <div className="h-[28px] bg-[var(--surface2)] border-t border-[var(--rule)] flex items-center justify-between px-3.5 font-mono text-[10px] tracking-wider text-[var(--dim)] shrink-0 relative">
        <div className="flex items-center gap-4">
          {isRestarting ? (
            <span className="text-[var(--accent)]">● RESTARTING</span>
          ) : isConnected ? (
            <span className="text-[var(--accent)]">● CONNECTED</span>
          ) : (
            <span className="text-[var(--delfg)]">● SESSION ENDED</span>
          )}
          {!isConnected && !isRestarting && (
            <button
              onClick={handleReconnect}
              className="hover:text-[var(--accent)]"
              title="Restart session"
            >
              RESTART
            </button>
          )}
          <span>{profile ? `${providerDisplayName(profileProvider(profile)).toUpperCase()} · ${profile.name.toUpperCase()}` : session.model}</span>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={hasTokens ? 'text-[var(--text)]' : 'text-[var(--dim)]'}
            title={tokenTitle}
          >
            {hasTokens
              ? `TOKENS ↑${formatTokenCount(tokenUsage!.inputTokens + tokenUsage!.cacheCreateTokens)} ↓${formatTokenCount(tokenUsage!.outputTokens)}`
              : 'TOKENS —'}
          </span>
          <span>{session.model.toUpperCase()}</span>
          <div className="relative">
            <button
              onClick={() => setIsModeMenuOpen(prev => !prev)}
              className="hover:text-[var(--text)]"
              title="Change permission mode"
            >
              MODE: {PERMISSION_MODES.find(m => m.value === permissionMode)?.label.toUpperCase()}
            </button>
            {isModeMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsModeMenuOpen(false)} />
                <div className="absolute bottom-full right-0 mb-1 w-[220px] bg-[var(--surface)] border-2 border-[var(--strong)] z-20 py-1">
                  {PERMISSION_MODES.map(m => (
                    <button
                      key={m.value}
                      onClick={() => handleModeChange(m.value)}
                      className={`w-full text-left px-3 py-2 hover:bg-[var(--tint)] ${m.value === permissionMode ? 'text-[var(--accent)]' : 'text-[var(--dim)]'}`}
                    >
                      <div className="text-[12px] font-semibold">{m.label}</div>
                      <div className="text-[10px] text-[var(--dim)] normal-case mt-0.5">{m.description}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => window.api.exportSession(session.id)}
            className="hover:text-[var(--accent)]"
            title="Export session transcript"
          >
            <Download size={11} />
          </button>
          <button
            onClick={handleExportSummary}
            disabled={isExportingSummary}
            className="hover:text-[var(--accent)] disabled:opacity-50"
            title="Export session summary (AI-generated)"
          >
            {isExportingSummary ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
          </button>
        </div>
      </div>

      {showTransfer && profile && (
        <TransferSessionModal
          sourceSessionId={session.id}
          sourceProfileId={profile.id}
          profiles={profiles}
          reason={transferReason}
          onClose={() => setShowTransfer(false)}
          onTransferred={(newId) => {
            setShowTransfer(false);
            setLimitDetected(false);
            onSessionTransferred(newId);
          }}
        />
      )}
    </div>
  );
}
