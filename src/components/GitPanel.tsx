import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Search, FilePlus, FileMinus, FileEdit, FileSymlink, File, Eye,
  Check, Loader2, UploadCloud,
} from 'lucide-react';
import { parseDiff, parseStatus, DiffFile, FileChangeStatus } from '../lib/parseDiff';
import { BranchSwitcher } from './BranchSwitcher';

interface GitPanelProps {
  workspacePath: string;
  onClose: () => void;
}

const STATUS_ICON: Record<FileChangeStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  added: FilePlus,
  deleted: FileMinus,
  renamed: FileSymlink,
  modified: FileEdit,
};

const STATUS_COLOR: Record<FileChangeStatus, string> = {
  added: 'text-[var(--color-status-green)]',
  deleted: 'text-[var(--color-status-red)]',
  renamed: 'text-[var(--color-accent)]',
  modified: 'text-[var(--color-status-amber)]',
};

const LOCK_FILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
]);

// Diffs beyond this many raw lines are hidden behind a "Show diff" affordance by
// default — even viewed one-at-a-time, a multi-thousand-line generated file diff
// isn't useful to render immediately.
const HUGE_LINE_THRESHOLD = 1500;

function splitFilePath(fullPath: string) {
  const parts = fullPath.split('/');
  const name = parts.pop() || fullPath;
  const dir = parts.length ? parts.join('/') + '/' : '';
  return { name, dir };
}

function DiffContent({ file }: { file: DiffFile }) {
  const [forceShow, setForceShow] = useState(false);
  const { name } = splitFilePath(file.displayPath);
  const isLockFile = LOCK_FILE_NAMES.has(name);
  const isHuge = file.lines.length > HUGE_LINE_THRESHOLD;
  const isGated = (isLockFile || isHuge) && !forceShow;

  if (file.binary) {
    return <div className="px-4 py-4 text-[12px] text-[var(--color-text-dim)] italic">Binary file — no preview available</div>;
  }

  if (isGated) {
    return (
      <div className="px-4 py-4 flex items-center gap-3">
        <span className="text-[12px] text-[var(--color-text-dim)]">
          {isLockFile
            ? 'Lock file — hidden by default to reduce noise.'
            : `Large diff — ${file.lines.length.toLocaleString()} lines hidden by default.`}
        </span>
        <button
          type="button"
          onClick={() => setForceShow(true)}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all"
        >
          <Eye size={12} />
          Show diff
        </button>
      </div>
    );
  }

  return (
    <div className="text-[12.5px] font-mono leading-[1.55] inline-block min-w-full">
      {file.lines.map((line, i) => {
        let cls = 'text-[var(--color-text-secondary)]';
        if (line.startsWith('@@')) cls = 'text-[var(--color-accent)] bg-[var(--color-accent)]/10';
        else if (line.startsWith('+')) cls = 'text-[var(--color-status-green)] bg-[#4CAF7D15]';
        else if (line.startsWith('-')) cls = 'text-[var(--color-status-red)] bg-[#E05C5C15]';

        return (
          <div key={i} className={`px-4 whitespace-pre ${cls}`}>
            {line || '\u00A0'}
          </div>
        );
      })}
    </div>
  );
}

export function GitPanel({ workspacePath, onClose }: GitPanelProps) {
  const [diff, setDiff] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [unstagedPaths, setUnstagedPaths] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = async () => {
    try {
      const res = await window.api.getGitDiff(workspacePath);
      if (!res.error) {
        setDiff(res.diff || '');
        setStatus(res.status || '');
        setBranch(res.branch || '');
        setError('');
      } else {
        setError(res.error);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load git status');
    }
  };

  useEffect(() => {
    setSelectedPath(null);
    setUnstagedPaths(new Set());
    setActionMessage(null);
    let cancelled = false;
    const fetchDiff = async () => {
      try {
        const res = await window.api.getGitDiff(workspacePath);
        if (cancelled) return;
        if (!res.error) {
          setDiff(res.diff || '');
          setStatus(res.status || '');
          setBranch(res.branch || '');
          setError('');
        } else {
          setError(res.error);
        }
      } catch {
        if (!cancelled) setError('Failed to load git status');
      }
    };
    fetchDiff();
    // Poll frequently enough that branch switches / new edits show up promptly.
    const interval = setInterval(fetchDiff, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspacePath]);

  // Close on Escape, like the other modals in the app.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const files = useMemo(() => parseDiff(diff), [diff]);
  const untracked = useMemo(() => parseStatus(status).filter(s => s.code === '??'), [status]);
  const totals = useMemo(
    () => files.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 }),
    [files]
  );

  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return files;
    const q = filter.toLowerCase();
    return files.filter(f => f.displayPath.toLowerCase().includes(q));
  }, [files, filter]);

  // Keep a file selected whenever possible — default to the first one so
  // opening the panel always shows something instead of an empty pane.
  useEffect(() => {
    if (selectedPath && files.some(f => f.displayPath === selectedPath)) return;
    setSelectedPath(files[0]?.displayPath ?? null);
  }, [files, selectedPath]);

  const selectedFile = files.find(f => f.displayPath === selectedPath) || null;

  const allPaths = useMemo(() => [...files.map(f => f.displayPath), ...untracked.map(u => u.path)], [files, untracked]);
  const isStaged = (path: string) => !unstagedPaths.has(path);
  const toggleStaged = (path: string) => {
    setUnstagedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const stagedCount = allPaths.filter(isStaged).length;
  const allStaged = allPaths.length > 0 && stagedCount === allPaths.length;
  const toggleStageAll = () => setUnstagedPaths(allStaged ? new Set(allPaths) : new Set());

  const handleCommit = async () => {
    const stagedPaths = allPaths.filter(isStaged);
    if (!commitMessage.trim() || stagedPaths.length === 0 || isCommitting) return;
    setIsCommitting(true);
    setActionMessage(null);
    try {
      const result = await window.api.gitCommit(workspacePath, commitMessage.trim(), stagedPaths);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Committed successfully' });
        setCommitMessage('');
        setUnstagedPaths(new Set());
        await refresh();
      } else {
        setActionMessage({ type: 'error', text: result.message || 'Commit failed' });
      }
    } catch (e: any) {
      setActionMessage({ type: 'error', text: e?.message || 'Commit failed unexpectedly' });
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (isPushing) return;
    setIsPushing(true);
    setActionMessage(null);
    try {
      const result = await window.api.gitPush(workspacePath);
      setActionMessage({
        type: result?.success ? 'success' : 'error',
        text: result?.message || (result?.success ? 'Pushed' : 'Push failed'),
      });
    } catch (e: any) {
      // IPC / unexpected failures must never leave the panel in a broken state.
      setActionMessage({ type: 'error', text: e?.message || 'Push failed unexpectedly' });
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-[100] flex items-center justify-center p-6">
      <div className="w-full h-full max-w-[1280px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-[52px] px-5 flex items-center justify-between border-b border-[var(--color-border-subtle)] shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-ui text-[12px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold shrink-0">Git Diff</span>
            <BranchSwitcher workspacePath={workspacePath} branch={branch} onBranchChanged={refresh} />
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {(totals.additions > 0 || totals.deletions > 0) && (
              <div className="flex items-center gap-2.5 font-mono text-[12px]">
                <span className="text-[var(--color-text-dim)]">{files.length} file{files.length !== 1 ? 's' : ''}</span>
                <span className="text-[var(--color-status-green)]">+{totals.additions}</span>
                <span className="text-[var(--color-status-red)]">-{totals.deletions}</span>
              </div>
            )}
            <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        {error ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">{error}</div>
        ) : files.length === 0 && untracked.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">No changes detected</div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* File list */}
            <div className="w-[320px] border-r border-[var(--color-border-subtle)] flex flex-col shrink-0 min-h-0">
              <div className="px-2.5 py-2 border-b border-[var(--color-border-subtle)] shrink-0 flex flex-col gap-2">
                <label className="flex items-center gap-2 px-0.5 text-[11px] text-[var(--color-text-dim)] cursor-pointer select-none">
                  <input type="checkbox" checked={allStaged} onChange={toggleStageAll} className="accent-[var(--color-accent)]" />
                  <span>{stagedCount} / {allPaths.length} staged for commit</span>
                </label>
                {files.length > 5 && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus-within:border-[var(--color-accent)] transition-colors">
                    <Search size={12} className="text-[var(--color-text-dim)] shrink-0" />
                    <input
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="Filter files…"
                      className="flex-1 bg-transparent outline-none text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)]"
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar">
                {filteredFiles.map(file => {
                  const { name, dir } = splitFilePath(file.displayPath);
                  const Icon = STATUS_ICON[file.status];
                  const isSelected = file.displayPath === selectedPath;
                  return (
                    <div
                      key={file.displayPath}
                      className={`flex items-center gap-2 px-3 py-2 border-l-2 transition-colors ${
                        isSelected ? 'border-[var(--color-accent)] bg-[var(--color-bg-hover)]' : 'border-transparent hover:bg-[var(--color-bg-hover)]/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isStaged(file.displayPath)}
                        onChange={() => toggleStaged(file.displayPath)}
                        className="shrink-0 accent-[var(--color-accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedPath(file.displayPath)}
                        title={file.displayPath}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                      >
                        <Icon size={13} className={`${STATUS_COLOR[file.status]} shrink-0`} />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className={`text-[12px] font-mono truncate ${isSelected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                            {name}
                          </span>
                          {dir && <span className="text-[10px] font-mono text-[var(--color-text-dim)] truncate">{dir}</span>}
                        </div>
                        {(file.additions > 0 || file.deletions > 0) && (
                          <span className="text-[10px] font-mono shrink-0 flex flex-col items-end gap-0.5">
                            {file.additions > 0 && <span className="text-[var(--color-status-green)]">+{file.additions}</span>}
                            {file.deletions > 0 && <span className="text-[var(--color-status-red)]">-{file.deletions}</span>}
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
                {filteredFiles.length === 0 && files.length > 0 && (
                  <div className="px-3 py-2 text-[12px] text-[var(--color-text-dim)]">No files match "{filter}"</div>
                )}

                {untracked.length > 0 && (
                  <div className="mt-2">
                    <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
                      Untracked ({untracked.length})
                    </div>
                    {untracked.map(entry => (
                      <div key={entry.path} className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-mono text-[var(--color-text-dim)]">
                        <input
                          type="checkbox"
                          checked={isStaged(entry.path)}
                          onChange={() => toggleStaged(entry.path)}
                          className="shrink-0 accent-[var(--color-accent)]"
                        />
                        <File size={12} className="shrink-0" />
                        <span className="truncate">{entry.path}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Diff detail */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {selectedFile ? (
                <>
                  <div className="h-[38px] px-4 flex items-center border-b border-[var(--color-border-subtle)] shrink-0 gap-2">
                    {(() => {
                      const Icon = STATUS_ICON[selectedFile.status];
                      return <Icon size={13} className={`${STATUS_COLOR[selectedFile.status]} shrink-0`} />;
                    })()}
                    <span className="text-[12.5px] font-mono text-[var(--color-text-primary)] truncate">{selectedFile.displayPath}</span>
                  </div>
                  <div className="flex-1 overflow-auto no-scrollbar">
                    <DiffContent file={selectedFile} />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">
                  {untracked.length > 0 ? 'Select a file to view its diff' : 'No changes detected'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Commit & push */}
        {!error && (files.length > 0 || untracked.length > 0) && (
          <div className="border-t border-[var(--color-border-subtle)] shrink-0">
            {actionMessage && (
              <div className={`px-4 pt-2 text-[12px] ${actionMessage.type === 'success' ? 'text-[var(--color-status-green)]' : 'text-[var(--color-status-red)]'}`}>
                {actionMessage.text}
              </div>
            )}
            <div className="p-3 flex items-center gap-2">
              <input
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit(); }}
                placeholder={`Commit message (${stagedCount} file${stagedCount !== 1 ? 's' : ''} staged)`}
                className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] text-[var(--color-text-primary)] transition-colors"
              />
              <button
                type="button"
                onClick={handleCommit}
                disabled={isCommitting || !commitMessage.trim() || stagedCount === 0}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCommitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Commit
              </button>
              <button
                type="button"
                onClick={handlePush}
                disabled={isPushing}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded text-[13px] font-medium border border-[var(--color-border-subtle)] hover:border-[var(--color-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
              >
                {isPushing ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                Push
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
