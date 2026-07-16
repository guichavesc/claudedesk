import React, { useEffect, useState } from 'react';
import { GitBranch, ChevronDown, Check, Loader2, Plus } from 'lucide-react';

interface BranchSwitcherProps {
  workspacePath: string;
  branch: string;
  onBranchChanged: () => void;
  /** Denser sizing for tight spaces like the session header. */
  compact?: boolean;
}

export function BranchSwitcher({ workspacePath, branch, onBranchChanged, compact }: BranchSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [menuError, setMenuError] = useState('');

  const loadBranches = async () => {
    const res = await window.api.getGitBranches(workspacePath);
    setBranches(res.branches || []);
  };

  useEffect(() => {
    if (isOpen) {
      setMenuError('');
      loadBranches();
    }
  }, [isOpen]);

  const handleSwitch = async (name: string) => {
    if (name === branch || isBusy) return;
    setIsBusy(true);
    setMenuError('');
    try {
      const result = await window.api.checkoutGitBranch(workspacePath, name);
      if (result.success) {
        setIsOpen(false);
        onBranchChanged();
      } else {
        setMenuError(result.message || 'Failed to switch branch');
      }
    } catch (e: any) {
      setMenuError(e?.message || 'Failed to switch branch');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = async () => {
    const name = newBranchName.trim();
    if (!name || isBusy) return;
    setIsBusy(true);
    setMenuError('');
    try {
      const result = await window.api.createGitBranch(workspacePath, name);
      if (result.success) {
        setNewBranchName('');
        setIsOpen(false);
        onBranchChanged();
      } else {
        setMenuError(result.message || 'Failed to create branch');
      }
    } catch (e: any) {
      setMenuError(e?.message || 'Failed to create branch');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        title="Switch or create a git branch"
        className={`flex items-center gap-1.5 min-w-0 rounded hover:bg-[var(--color-bg-hover)] transition-colors ${
          compact
            ? 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] px-2 py-1'
            : 'text-[13px] text-[var(--color-text-primary)] font-medium px-2 py-1 -mx-2'
        }`}
      >
        <GitBranch size={compact ? 12 : 14} className={`shrink-0 ${compact ? '' : 'text-[var(--color-accent)]'}`} />
        <span className={`truncate ${compact ? 'max-w-[120px]' : 'max-w-[160px]'}`}>{branch || '—'}</span>
        <ChevronDown size={compact ? 10 : 12} className="text-[var(--color-text-dim)] shrink-0" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[280px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-md shadow-2xl z-20 py-1 animate-[fadeIn_0.15s_ease-out]">
            <div className="max-h-[260px] overflow-y-auto no-scrollbar">
              {branches.map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => handleSwitch(b)}
                  disabled={isBusy}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] font-mono hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 ${
                    b === branch ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  <Check size={12} className={b === branch ? 'opacity-100' : 'opacity-0'} />
                  <span className="truncate">{b}</span>
                </button>
              ))}
              {branches.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-[var(--color-text-dim)]">No branches found</div>
              )}
            </div>

            <div className="border-t border-[var(--color-border-subtle)] mt-1 pt-2 px-2 flex items-center gap-1.5">
              <input
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                placeholder="New branch name…"
                className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newBranchName.trim() || isBusy}
                className="shrink-0 p-1.5 rounded bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 transition-all"
                title="Create branch"
              >
                <Plus size={13} />
              </button>
            </div>

            {isBusy && (
              <div className="px-3 pt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)]">
                <Loader2 size={11} className="animate-spin" /> Working…
              </div>
            )}
            {menuError && (
              <div className="px-3 pt-2 text-[11px] text-[var(--color-status-red)]">{menuError}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
