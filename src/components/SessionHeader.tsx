import React, { useEffect, useState } from 'react';
import { FolderOpen, GitBranch, User, Calendar } from 'lucide-react';
import { Profile, formatSessionStarted } from '../types';
import { BranchSwitcher } from './BranchSwitcher';

interface SessionHeaderProps {
  workspacePath: string;
  startedAt: string;
  profile?: Profile;
  isGitPanelOpen: boolean;
  onToggleGitPanel: () => void;
}

export function SessionHeader({ workspacePath, startedAt, profile, isGitPanelOpen, onToggleGitPanel }: SessionHeaderProps) {
  const folderName = workspacePath.split('/').filter(Boolean).pop() || workspacePath;
  const parentPath = workspacePath.slice(0, workspacePath.length - folderName.length).replace(/\/$/, '');
  const startedLabel = formatSessionStarted(startedAt);

  const [branch, setBranch] = useState('');
  const [isGitRepo, setIsGitRepo] = useState(true);

  const refreshBranch = async () => {
    try {
      const res = await window.api.getGitBranches(workspacePath);
      if (res.error) {
        setIsGitRepo(false);
        setBranch('');
      } else {
        setIsGitRepo(true);
        setBranch(res.current || '');
      }
    } catch {
      setIsGitRepo(false);
      setBranch('');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchBranch = async () => {
      try {
        const res = await window.api.getGitBranches(workspacePath);
        if (cancelled) return;
        if (res.error) {
          setIsGitRepo(false);
          setBranch('');
        } else {
          setIsGitRepo(true);
          setBranch(res.current || '');
        }
      } catch {
        if (!cancelled) {
          setIsGitRepo(false);
          setBranch('');
        }
      }
    };
    fetchBranch();
    // Poll so switching branches from the terminal or elsewhere reflects here too.
    const interval = setInterval(fetchBranch, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspacePath]);

  return (
    <div className="h-[36px] shrink-0 flex items-center justify-between px-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[12px] gap-3">
      <div className="flex items-center gap-1.5 min-w-0 flex-1" title={workspacePath}>
        <FolderOpen size={13} className="text-[var(--color-accent)] shrink-0" />
        <span className="text-[var(--color-text-primary)] font-medium truncate">{folderName}</span>
        {parentPath && (
          <span className="text-[var(--color-text-dim)] truncate">{parentPath}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--color-text-dim)]"
          title={startedLabel}
        >
          <Calendar size={12} />
          <span className="whitespace-nowrap">{startedLabel}</span>
        </span>
        {profile && (
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--color-text-dim)]"
            title={`Profile: ${profile.name}`}
          >
            <User size={12} />
            <span>{profile.name}</span>
          </span>
        )}
        {isGitRepo && (
          <BranchSwitcher workspacePath={workspacePath} branch={branch} onBranchChanged={refreshBranch} compact />
        )}
        <button
          onClick={() => window.api.openWorkspaceFolder(workspacePath)}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          title="Open folder in Finder"
        >
          <FolderOpen size={12} />
          <span>Reveal</span>
        </button>
        <button
          onClick={onToggleGitPanel}
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
            isGitPanelOpen
              ? 'bg-[var(--color-bg-hover)] text-[var(--color-accent)]'
              : 'text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
          }`}
          title="Toggle git diff panel"
        >
          <GitBranch size={12} />
          <span>Diff</span>
        </button>
      </div>
    </div>
  );
}
