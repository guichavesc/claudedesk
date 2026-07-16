import React, { useEffect, useRef, useState } from 'react';
import { Download, ChevronDown, RotateCcw, FileText, Loader2 } from 'lucide-react';
import { Session, Profile, PermissionMode, PERMISSION_MODES } from '../types';
import { TerminalView, TerminalViewHandle } from './TerminalView';
import { SessionHeader } from './SessionHeader';

interface ChatAreaProps {
  session: Session;
  profile?: Profile;
  isGitPanelOpen: boolean;
  onToggleGitPanel: () => void;
}

export function ChatArea({ session, profile, isGitPanelOpen, onToggleGitPanel }: ChatAreaProps) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(session.permission_mode || 'default');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const termRef = useRef<TerminalViewHandle>(null);

  useEffect(() => {
    setPermissionMode(session.permission_mode || 'default');
    setIsConnected(true);

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

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[var(--color-bg-base)]">
      <SessionHeader
        workspacePath={session.workspace_path}
        startedAt={session.started_at}
        profile={profile}
        isGitPanelOpen={isGitPanelOpen}
        onToggleGitPanel={onToggleGitPanel}
      />
      <TerminalView ref={termRef} onResize={handleResize} onData={handleData} />

      {/* Status Bar */}
      <div className="h-[28px] bg-[var(--color-bg-elevated)] border-t border-[var(--color-border-subtle)] flex items-center justify-between px-4 text-[11px] font-ui text-[var(--color-text-dim)] shrink-0 relative">
        <div className="flex items-center gap-2">
          {isRestarting ? (
            <span className="w-2 h-2 rounded-full bg-[var(--color-status-amber)] shadow-[0_0_8px_var(--color-status-amber)] animate-pulse" />
          ) : isConnected ? (
            <span className="w-2 h-2 rounded-full bg-[var(--color-status-green)] shadow-[0_0_8px_var(--color-status-green)]" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-[var(--color-status-red)] shadow-[0_0_8px_var(--color-status-red)]" />
          )}
          <span>{isRestarting ? 'restarting...' : isConnected ? 'connected' : 'session ended'}</span>
          {!isConnected && !isRestarting && (
            <button
              onClick={handleReconnect}
              className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              title="Restart session"
            >
              <RotateCcw size={11} />
              <span>restart</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span>MODEL: {session.model}</span>
          <div className="relative">
            <button
              onClick={() => setIsModeMenuOpen(prev => !prev)}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              title="Change permission mode"
            >
              <span>MODE: {PERMISSION_MODES.find(m => m.value === permissionMode)?.label}</span>
              <ChevronDown size={12} />
            </button>
            {isModeMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsModeMenuOpen(false)} />
                <div className="absolute bottom-full right-0 mb-1 w-[220px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-md shadow-2xl z-20 py-1 animate-[fadeIn_0.15s_ease-out]">
                  {PERMISSION_MODES.map(m => (
                    <button
                      key={m.value}
                      onClick={() => handleModeChange(m.value)}
                      className={`w-full text-left px-3 py-2 hover:bg-[var(--color-bg-hover)] transition-colors ${m.value === permissionMode ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}
                    >
                      <div className="text-[12px] font-semibold">{m.label}</div>
                      <div className="text-[10px] text-[var(--color-text-dim)] normal-case mt-0.5">{m.description}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => window.api.exportSession(session.id)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Export session transcript"
          >
            <Download size={11} />
          </button>
          <button
            onClick={handleExportSummary}
            disabled={isExportingSummary}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
            title="Export session summary (AI-generated)"
          >
            {isExportingSummary ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}
