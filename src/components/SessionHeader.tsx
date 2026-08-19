import React, { useEffect, useState } from 'react';
import { Profile, Session, formatSessionStarted, providerDisplayName, profileProvider, sessionTitle } from '../types';
import { BranchSwitcher } from './BranchSwitcher';

interface SessionHeaderProps {
  session: Session;
  profile?: Profile;
  isGitPanelOpen: boolean;
  onToggleGitPanel: () => void;
  onMigrate: () => void;
}

export function SessionHeader({ session, profile, isGitPanelOpen, onToggleGitPanel, onMigrate }: SessionHeaderProps) {
  const workspacePath = session.workspace_path;
  const folderName = workspacePath.split('/').filter(Boolean).pop() || workspacePath;
  const startedLabel = formatSessionStarted(session.started_at);

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
    const interval = setInterval(fetchBranch, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workspacePath]);

  return (
    <div className="h-[44px] shrink-0 flex items-center gap-3 px-4 border-b border-[var(--rule)] bg-[var(--surface)]">
      <span className="text-[13px] font-bold truncate">{sessionTitle(session)}</span>
      <span className="font-mono text-[10.5px] text-[var(--dim)] truncate" title={workspacePath}>
        {workspacePath}{branch ? ` · ${branch}` : ''}
      </span>
      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] tracking-widest shrink-0">
        {profile && (
          <span className="cd-chip-accent">
            {providerDisplayName(profileProvider(profile)).toUpperCase()} · {profile.name.toUpperCase()}
          </span>
        )}
        <span className="text-[var(--dim)]" title={startedLabel}>{startedLabel.replace('Session Started ', '').toUpperCase()}</span>
        {isGitRepo && (
          <BranchSwitcher workspacePath={workspacePath} branch={branch} onBranchChanged={refreshBranch} compact />
        )}
        <button
          type="button"
          onClick={() => window.api.openWorkspaceFolder(workspacePath)}
          className="cd-btn-outline"
        >
          REVEAL
        </button>
        <button
          type="button"
          onClick={onToggleGitPanel}
          className={isGitPanelOpen ? 'cd-btn-outline border-[var(--accent)] text-[var(--accent)]' : 'cd-btn-outline'}
        >
          DIFF
        </button>
        <button type="button" onClick={onMigrate} className="cd-btn-outline border-[var(--accent)] text-[var(--accent)]">
          MIGRATE →
        </button>
      </div>
    </div>
  );
}
