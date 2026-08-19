import React, { useState, useEffect, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { WorkbenchNav } from './components/WorkbenchNav';
import { ChatArea } from './components/ChatArea';
import { GitPanel } from './components/GitPanel';
import { NewSessionModal } from './components/NewSessionModal';
import { NewProfileModal } from './components/NewProfileModal';
import { NewProjectModal } from './components/NewProjectModal';
import { SettingsModal } from './components/SettingsModal';
import { QuickSwitcher } from './components/QuickSwitcher';
import {
  Session,
  Profile,
  Project,
  sessionDisplayName,
  isSessionActive,
  UNCATEGORIZED_PROJECT_ID,
} from './types';
import { SELECTED_PROJECT_KEY } from './lib/appearance';

function pickNextActiveSession(
  sessions: Session[],
  leavingId: string,
  preferredProjectId?: string | null,
): string | null {
  const remaining = sessions.filter(s => s.id !== leavingId && isSessionActive(s));
  if (preferredProjectId) {
    const same = remaining.find(s => (s.project_id || UNCATEGORIZED_PROJECT_ID) === preferredProjectId);
    if (same) return same.id;
  }
  return remaining[0]?.id ?? null;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    localStorage.getItem(SELECTED_PROJECT_KEY),
  );
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [isGitPanelOpen, setIsGitPanelOpen] = useState(false);
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profiles' | 'projects' | 'mcp' | 'appearance'>('profiles');

  useEffect(() => {
    waitForApi().then(loadData);
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    waitForApi().then(() => {
      unsubscribe = window.api.onSessionTitleUpdated((sessionId, title) => {
        setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const tick = () => {
      if (!window.api?.getRunningSessionIds) return;
      window.api.getRunningSessionIds().then(setRunningIds).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [activeSessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        setIsSwitcherOpen(true);
      } else if (meta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setIsSessionModalOpen(true);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        document.dispatchEvent(new Event('claudedesk:migrate'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const waitForApi = (): Promise<void> => {
    if (window.api) return Promise.resolve();
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (window.api) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  };

  const loadData = async () => {
    const [profs, sess, projs] = await Promise.all([
      window.api.getProfiles(),
      window.api.getSessions(),
      window.api.getProjects(),
    ]);
    setProfiles(profs);
    setSessions(sess);
    setProjects(projs);

    const activeSessions = sess.filter(isSessionActive);
    setActiveSessionId(prev => {
      if (prev && activeSessions.some(s => s.id === prev)) return prev;
      return activeSessions[0]?.id ?? null;
    });
    setActiveProfileId(prev => {
      if (prev && profs.some(p => p.id === prev)) return prev;
      const fromSession = activeSessions[0] && profs.find(p => p.id === activeSessions[0].profile_id);
      return fromSession?.id ?? profs[0]?.id ?? null;
    });
    setSelectedProjectId(prev => {
      const stored = prev || localStorage.getItem(SELECTED_PROJECT_KEY);
      if (stored === UNCATEGORIZED_PROJECT_ID && sess.some(s => !s.project_id)) return stored;
      if (stored && projs.some(p => p.id === stored)) return stored;
      const firstWithSessions = projs.find(p => sess.some(s => s.project_id === p.id && isSessionActive(s)));
      if (firstWithSessions) return firstWithSessions.id;
      if (sess.some(s => !s.project_id)) return UNCATEGORIZED_PROJECT_ID;
      return projs[0]?.id ?? null;
    });
  };

  const selectProject = useCallback((id: string | null) => {
    setSelectedProjectId(id);
    if (id) localStorage.setItem(SELECTED_PROJECT_KEY, id);
    else localStorage.removeItem(SELECTED_PROJECT_KEY);
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    const pid = s.project_id || (sessions.some(x => !x.project_id) ? UNCATEGORIZED_PROJECT_ID : null);
    if (pid) selectProject(pid);
    setActiveProfileId(s.profile_id);
  }, [sessions, selectProject]);

  const handleCreateSession = async (data: any) => {
    const projectId = data.projectId === UNCATEGORIZED_PROJECT_ID ? null : data.projectId || (
      selectedProjectId === UNCATEGORIZED_PROJECT_ID ? null : selectedProjectId
    );
    const id = await window.api.createSession({ ...data, projectId });
    await loadData();
    setActiveSessionId(id);
    if (projectId) selectProject(projectId);
    else selectProject(UNCATEGORIZED_PROJECT_ID);
    setIsSessionModalOpen(false);
  };

  const handleCreateProfile = async (data: {
    name: string;
    authType: string;
    apiKey?: string;
    provider: 'claude' | 'gemini' | 'codex';
  }) => {
    const result = await window.api.createProfile(data);
    if (result && typeof result === 'object' && 'success' in result && result.success === false) {
      const hint = result.installHint ? `\n\n${result.installHint}` : '';
      alert((result.message || 'Failed to create profile') + hint);
      return;
    }
    await loadData();
    setIsProfileModalOpen(false);
  };

  const handleArchiveSession = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    const sessionName = session ? sessionDisplayName(session) : 'this session';
    if (!confirm(`Archive "${sessionName}"? You can reopen it later.`)) return;
    const result = await window.api.archiveSession(sessionId);
    if (result.success) {
      if (activeSessionId === sessionId) {
        setActiveSessionId(pickNextActiveSession(sessions, sessionId, session?.project_id || UNCATEGORIZED_PROJECT_ID));
      }
      await loadData();
    } else {
      alert(result.message || 'Failed to archive session');
    }
  };

  const handleReopenSession = async (sessionId: string) => {
    const result = await window.api.unarchiveSession(sessionId);
    if (result.success) {
      await loadData();
      setActiveSessionId(sessionId);
    } else {
      alert(result.message || 'Failed to reopen session');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    const sessionName = session ? sessionDisplayName(session) : 'this session';
    if (!confirm(`Permanently delete "${sessionName}"? This cannot be undone.`)) return;
    const result = await window.api.deleteSession(sessionId);
    if (result.success) {
      if (activeSessionId === sessionId) {
        setActiveSessionId(pickNextActiveSession(sessions, sessionId, session?.project_id || UNCATEGORIZED_PROJECT_ID));
      }
      await loadData();
    } else {
      alert(result.message || 'Failed to delete session');
    }
  };

  const handleRenameSession = async (sessionId: string, title: string) => {
    const cleaned = title.trim();
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: cleaned || null } : s)));
    const result = await window.api.updateSessionTitle(sessionId, cleaned);
    if (!result.success) {
      await loadData();
      alert(result.message || 'Failed to rename session');
    }
  };

  const handleMoveSession = async (sessionId: string, projectId: string | null) => {
    const result = await window.api.updateSessionProject(sessionId, projectId);
    if (!result.success) {
      alert(result.message || 'Failed to move session');
      return;
    }
    await loadData();
    selectProject(projectId || UNCATEGORIZED_PROJECT_ID);
  };

  const activeSessions = sessions.filter(isSessionActive);
  const activeSession = sessions.find(s => s.id === activeSessionId && isSessionActive(s))
    || activeSessions.find(s => s.id === activeSessionId);
  const activeProfile = activeSession ? profiles.find(p => p.id === activeSession.profile_id) : undefined;

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      <TitleBar
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={setActiveProfileId}
        onNewProfile={() => setIsProfileModalOpen(true)}
        onOpenSwitcher={() => setIsSwitcherOpen(true)}
        onOpenSettings={() => {
          setSettingsTab('profiles');
          setIsSettingsModalOpen(true);
        }}
      />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <WorkbenchNav
          projects={projects}
          sessions={sessions}
          profiles={profiles}
          selectedProjectId={selectedProjectId}
          activeSessionId={activeSessionId}
          runningIds={runningIds}
          onSelectProject={selectProject}
          onSelectSession={selectSession}
          onNewProject={() => setIsProjectModalOpen(true)}
          onNewSession={() => setIsSessionModalOpen(true)}
          onArchiveSession={handleArchiveSession}
          onReopenSession={handleReopenSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onMoveSession={handleMoveSession}
        />
        <div className="flex-1 flex flex-col relative min-w-0">
          {activeSession ? (
            <ChatArea
              session={activeSession}
              profile={activeProfile}
              profiles={profiles}
              isGitPanelOpen={isGitPanelOpen}
              onToggleGitPanel={() => setIsGitPanelOpen(prev => !prev)}
              onSessionTransferred={async (newId) => {
                await loadData();
                setActiveSessionId(newId);
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--dim)] font-mono text-[12px] tracking-widest">
              Select or create a session
            </div>
          )}
        </div>
      </div>

      {isGitPanelOpen && activeSession && (
        <GitPanel workspacePath={activeSession.workspace_path} onClose={() => setIsGitPanelOpen(false)} />
      )}

      {isSessionModalOpen && (
        <NewSessionModal
          profiles={profiles}
          projects={projects}
          defaultProfileId={activeProfileId}
          defaultProjectId={selectedProjectId}
          onClose={() => setIsSessionModalOpen(false)}
          onSubmit={handleCreateSession}
        />
      )}

      {isProfileModalOpen && (
        <NewProfileModal
          onClose={() => setIsProfileModalOpen(false)}
          onSubmit={handleCreateProfile}
        />
      )}

      {isProjectModalOpen && (
        <NewProjectModal
          onClose={() => setIsProjectModalOpen(false)}
          onCreated={async (project) => {
            await loadData();
            selectProject(project.id);
            setIsProjectModalOpen(false);
          }}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          profiles={profiles}
          projects={projects}
          sessions={sessions}
          initialTab={settingsTab}
          onClose={() => setIsSettingsModalOpen(false)}
          onReload={loadData}
          onNewProfile={() => {
            setIsSettingsModalOpen(false);
            setIsProfileModalOpen(true);
          }}
        />
      )}

      {isSwitcherOpen && (
        <QuickSwitcher
          sessions={sessions}
          profiles={profiles}
          projects={projects}
          onClose={() => setIsSwitcherOpen(false)}
          onSelectSession={selectSession}
          onMigrate={() => document.dispatchEvent(new Event('claudedesk:migrate'))}
          onNewSession={() => setIsSessionModalOpen(true)}
        />
      )}
    </div>
  );
}

export default App;
