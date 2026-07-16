import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { TabsBar } from './components/TabsBar';
import { ChatArea } from './components/ChatArea';
import { GitPanel } from './components/GitPanel';
import { NewSessionModal } from './components/NewSessionModal';
import { NewProfileModal } from './components/NewProfileModal';
import { SettingsModal } from './components/SettingsModal';
import {
  Session,
  Profile,
  sessionDisplayName,
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from './types';

function readSidebarWidth(): number {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : SIDEBAR_WIDTH_DEFAULT;
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isGitPanelOpen, setIsGitPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    // In dev mode, Electron's window can occasionally start rendering a hair before
    // vite-plugin-electron finishes its first preload build, so window.api briefly
    // doesn't exist yet. Wait for it rather than failing the initial load.
    waitForApi().then(loadData);
  }, []);

  // Keep tab/sidebar labels in sync when the main process auto-generates a title
  // from the conversation transcript.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    waitForApi().then(() => {
      unsubscribe = window.api.onSessionTitleUpdated((sessionId, title) => {
        setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
      });
    });
    return () => unsubscribe?.();
  }, []);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, ev.clientX));
      setSidebarWidth(next);
    };

    const onUp = () => {
      setIsResizingSidebar(false);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
    const profs = await window.api.getProfiles();
    const sess = await window.api.getSessions();
    setProfiles(profs);
    setSessions(sess);
    if (sess.length > 0 && !activeSessionId) {
      setActiveSessionId(sess[0].id);
    }
  };

  const handleCreateSession = async (data: any) => {
    const id = await window.api.createSession(data);
    await loadData();
    setActiveSessionId(id);
    setIsSessionModalOpen(false);
  };

  const handleCreateProfile = async (data: { name: string; authType: 'subscription' | 'apikey'; apiKey?: string }) => {
    await window.api.createProfile(data);
    await loadData();
    setIsProfileModalOpen(false);
  };

  const handleCloseSession = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    const sessionName = session ? sessionDisplayName(session) : 'this session';

    if (!confirm(`Close "${sessionName}"? This will end the session and all unsaved work will be lost.`)) {
      return;
    }

    const result = await window.api.deleteSession(sessionId);
    
    if (result.success) {
      // If we're closing the active session, switch to another one
      if (activeSessionId === sessionId) {
        const remainingSessions = sessions.filter(s => s.id !== sessionId);
        setActiveSessionId(remainingSessions.length > 0 ? remainingSessions[0].id : null);
      }
      await loadData();
    } else {
      alert(result.message || 'Failed to close session');
    }
  };

  const handleChangeSessionColor = async (sessionId: string, color: string) => {
    // Optimistic update so the tab recolors immediately.
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, color } : s)));
    const result = await window.api.updateSessionColor(sessionId, color);
    if (!result.success) {
      await loadData();
      alert(result.message || 'Failed to update session color');
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const activeProfile = activeSession ? profiles.find(p => p.id === activeSession.profile_id) : undefined;

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] font-mono overflow-hidden">
      <TitleBar />
      <TabsBar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={setActiveSessionId}
        onNew={() => setIsSessionModalOpen(true)}
        onClose={handleCloseSession}
        onChangeColor={handleChangeSessionColor}
      />
      <div className={`flex flex-1 overflow-hidden min-h-0 ${isResizingSidebar ? 'select-none' : ''}`}>
        {isSidebarOpen && (
          <>
            <Sidebar
              profiles={profiles}
              sessions={sessions}
              activeSessionId={activeSessionId}
              width={sidebarWidth}
              onSelectSession={setActiveSessionId}
              onReload={loadData}
              onNewProfile={() => setIsProfileModalOpen(true)}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
            />
            {/* Drag handle — chat flexes via min-w-0; TerminalView's ResizeObserver refits xterm. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onMouseDown={handleSidebarResizeStart}
              className={`w-1 shrink-0 cursor-col-resize relative z-10 group ${
                isResizingSidebar ? 'bg-[var(--color-accent)]' : 'bg-transparent hover:bg-[var(--color-accent)]/50'
              } transition-colors`}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          </>
        )}
        <div className="flex-1 flex flex-col relative min-w-0">
          {activeSession ? (
            <ChatArea
              session={activeSession}
              profile={activeProfile}
              isGitPanelOpen={isGitPanelOpen}
              onToggleGitPanel={() => setIsGitPanelOpen(prev => !prev)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--color-text-dim)]">
              Select or create a session to begin
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

      {isSettingsModalOpen && (
        <SettingsModal
          profiles={profiles}
          onClose={() => setIsSettingsModalOpen(false)}
          onReload={loadData}
        />
      )}
    </div>
  );
}

export default App;
