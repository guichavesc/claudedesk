import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Profile,
  Project,
  Session,
  UNCATEGORIZED_PROJECT_ID,
  isSessionActive,
  profileProvider,
  providerDisplayName,
  sessionTitle,
} from '../types';
import { formatRelativeTime } from '../lib/time';
import {
  APPEARANCE_EVENT,
  PROJECTS_PANE_KEY,
  SESSIONS_PANE_KEY,
  SHOW_AGENT_BADGE_KEY,
  readBool,
} from '../lib/appearance';

interface WorkbenchNavProps {
  projects: Project[];
  sessions: Session[];
  profiles: Profile[];
  selectedProjectId: string | null;
  activeSessionId: string | null;
  runningIds: string[];
  onSelectProject: (id: string | null) => void;
  onSelectSession: (id: string) => void;
  onNewProject: () => void;
  onNewSession: () => void;
  onArchiveSession: (id: string) => void;
  onReopenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onMoveSession: (sessionId: string, projectId: string | null) => void;
}

export function WorkbenchNav({
  projects,
  sessions,
  profiles,
  selectedProjectId,
  activeSessionId,
  runningIds,
  onSelectProject,
  onSelectSession,
  onNewProject,
  onNewSession,
  onArchiveSession,
  onReopenSession,
  onDeleteSession,
  onRenameSession,
  onMoveSession,
}: WorkbenchNavProps) {
  const [showBadge, setShowBadge] = useState(readBool(SHOW_AGENT_BADGE_KEY, true));
  const [projectsOpen, setProjectsOpen] = useState(readBool(PROJECTS_PANE_KEY, true));
  const [sessionsOpen, setSessionsOpen] = useState(readBool(SESSIONS_PANE_KEY, true));
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setShowBadge(readBool(SHOW_AGENT_BADGE_KEY, true));
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  const uncategorizedCount = sessions.filter(s => !s.project_id).length;

  const projectRows = useMemo(() => {
    return projects.map(p => {
      const list = sessions.filter(s => s.project_id === p.id);
      const active = list.filter(isSessionActive);
      const running = active.filter(s => runningIds.includes(s.id)).length;
      return { project: p, total: list.length, active: active.length, running };
    });
  }, [projects, sessions, runningIds]);

  const selectedSessions = sessions.filter(s =>
    selectedProjectId === UNCATEGORIZED_PROJECT_ID
      ? !s.project_id
      : selectedProjectId
        ? s.project_id === selectedProjectId
        : false,
  );
  const activeList = selectedSessions.filter(isSessionActive);
  const archivedList = selectedSessions.filter(s => !isSessionActive(s));
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedLabel = selectedProjectId === UNCATEGORIZED_PROJECT_ID
    ? 'UNCATEGORIZED'
    : (selectedProject?.name || 'PROJECT').toUpperCase();

  useEffect(() => {
    if (editingId) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editingId]);

  const profileFor = (s: Session) => profiles.find(p => p.id === s.profile_id);

  const toggleProjects = () => {
    setProjectsOpen(open => {
      const next = !open;
      localStorage.setItem(PROJECTS_PANE_KEY, next ? 'true' : 'false');
      return next;
    });
  };

  const toggleSessions = () => {
    setSessionsOpen(open => {
      const next = !open;
      localStorage.setItem(SESSIONS_PANE_KEY, next ? 'true' : 'false');
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 shrink-0">
      {!projectsOpen ? (
        <button
          type="button"
          onClick={toggleProjects}
          title="Expand projects"
          className="w-8 shrink-0 border-r-2 border-[var(--strong)] bg-[var(--surface)] flex flex-col items-center gap-3 pt-3 text-[var(--dim)] hover:text-[var(--accent)] hover:bg-[var(--tint)]"
        >
          <ChevronRight size={14} />
          <span className="cd-label" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            Projects
          </span>
        </button>
      ) : (
      <div className="w-[236px] shrink-0 border-r-2 border-[var(--strong)] bg-[var(--surface)] flex flex-col min-h-0">
        <div className="px-3.5 py-3 border-b border-[var(--rule)] flex items-center justify-between gap-2">
          <span className="cd-label">Projects</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onNewProject} className="text-[12px] text-[var(--accent)] hover:brightness-110" title="New project">+</button>
            <button type="button" onClick={toggleProjects} className="text-[var(--dim)] hover:text-[var(--accent)]" title="Collapse projects">
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {projectRows.map(({ project, active, running }) => {
            const selected = selectedProjectId === project.id;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project.id)}
                className={`w-full text-left flex flex-col gap-0.5 px-3.5 py-2.5 border-b border-[var(--rule)] border-l-2 ${
                  selected ? 'border-l-[var(--accent)] bg-[var(--sel)]' : 'border-l-transparent hover:bg-[var(--tint)]'
                }`}
              >
                <span className={`text-[12.5px] truncate ${selected ? 'font-semibold' : 'font-medium'}`}>{project.name}</span>
                <span className={`font-mono text-[9px] tracking-widest ${selected ? 'text-[var(--accent)]' : 'text-[var(--dim)]'}`}>
                  {active} SESSION{active === 1 ? '' : 'S'}{running ? ` · ${running} RUNNING` : ''}
                </span>
              </button>
            );
          })}
          {uncategorizedCount > 0 && (
            <button
              type="button"
              onClick={() => onSelectProject(UNCATEGORIZED_PROJECT_ID)}
              className={`w-full text-left flex flex-col gap-0.5 px-3.5 py-2.5 border-b border-[var(--rule)] border-l-2 ${
                selectedProjectId === UNCATEGORIZED_PROJECT_ID
                  ? 'border-l-[var(--accent)] bg-[var(--sel)]'
                  : 'border-l-transparent hover:bg-[var(--tint)]'
              }`}
            >
              <span className="text-[12.5px] font-medium">Uncategorized</span>
              <span className="font-mono text-[9px] tracking-widest text-[var(--dim)]">
                {sessions.filter(s => !s.project_id && isSessionActive(s)).length} SESSIONS
              </span>
            </button>
          )}
          {projects.length === 0 && uncategorizedCount === 0 && (
            <div className="px-3.5 py-3 text-[11px] text-[var(--dim)]">No projects yet</div>
          )}
        </div>
      </div>
      )}

      {!sessionsOpen ? (
        <button
          type="button"
          onClick={toggleSessions}
          title="Expand sessions"
          className="w-8 shrink-0 border-r-2 border-[var(--strong)] bg-[var(--bg)] flex flex-col items-center gap-3 pt-3 text-[var(--dim)] hover:text-[var(--accent)] hover:bg-[var(--tint)]"
        >
          <ChevronRight size={14} />
          <span className="cd-label" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            Sessions
          </span>
        </button>
      ) : (
      <div className="w-[352px] shrink-0 border-r-2 border-[var(--strong)] bg-[var(--bg)] flex flex-col min-h-0">
        <div className="px-3.5 py-3 border-b border-[var(--rule)] flex items-center justify-between gap-2">
          <span className="cd-label truncate">Sessions · {selectedLabel}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onNewSession} className="text-[12px] text-[var(--accent)]" title="New session">+</button>
            <button type="button" onClick={toggleSessions} className="text-[var(--dim)] hover:text-[var(--accent)]" title="Collapse sessions">
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {!selectedProjectId && (
            <div className="px-3.5 py-3 text-[11px] text-[var(--dim)]">Select a project</div>
          )}
          {activeList.map(s => {
            const isActive = s.id === activeSessionId;
            const running = runningIds.includes(s.id);
            const p = profileFor(s);
            const agent = providerDisplayName(s.provider || profileProvider(p)).toUpperCase();
            const isEditing = editingId === s.id;
            return (
              <div
                key={s.id}
                className={`flex flex-col gap-2 px-3.5 py-3 border-b border-[var(--rule)] border-l-2 relative group ${
                  isActive ? 'border-l-[var(--accent)] bg-[var(--sel)]' : 'border-l-transparent hover:bg-[var(--tint)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-[7px] h-[7px] shrink-0 ${running ? 'bg-[var(--accent)]' : 'bg-[var(--dim)]'}`} />
                  {isEditing ? (
                    <input
                      ref={editRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => {
                        onRenameSession(s.id, editValue);
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameSession(s.id, editValue);
                          setEditingId(null);
                        } else if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 min-w-0 bg-[var(--bg)] border border-[var(--strong)] px-1 py-0.5 text-[13px] outline-none focus:border-[var(--accent)]"
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => onSelectSession(s.id)}
                      onDoubleClick={() => {
                        setEditingId(s.id);
                        setEditValue(s.title?.trim() || '');
                      }}
                      title={`${sessionTitle(s)}\n${s.workspace_path}`}
                    >
                      <span className={`text-[13px] truncate block ${isActive ? 'font-semibold' : 'font-medium'}`}>
                        {sessionTitle(s)}
                      </span>
                    </button>
                  )}
                  <span className={`font-mono text-[9px] tracking-widest ${running ? 'text-[var(--accent)]' : 'text-[var(--dim)]'}`}>
                    {running ? 'RUNNING' : formatRelativeTime(s.started_at)}
                  </span>
                </div>
                <div className="font-mono text-[10.5px] text-[var(--dim)] truncate pl-[15px]">
                  {s.workspace_path.split('/').filter(Boolean).pop()}
                  {s.parent_session_id ? ' · migrated' : ''}
                </div>
                <div className="flex gap-1.5 items-center pl-[15px]">
                  {showBadge && (
                    <span className={agent === 'CLAUDE' ? 'cd-chip-accent' : 'cd-chip'}>{agent}</span>
                  )}
                  <span className="cd-chip">{(p?.name || 'PROFILE').toUpperCase()}</span>
                  <div className="ml-auto opacity-0 group-hover:opacity-100 flex gap-1">
                    <button type="button" className="cd-btn-outline" onClick={() => setMoveFor(s.id)}>MOVE</button>
                    <button type="button" className="cd-btn-outline" onClick={() => onArchiveSession(s.id)}>ARCHIVE</button>
                  </div>
                </div>
                {moveFor === s.id && (
                  <div className="ml-[15px] border border-[var(--rule)] bg-[var(--surface)]">
                    <button
                      type="button"
                      className="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--tint)]"
                      onClick={() => {
                        onMoveSession(s.id, null);
                        setMoveFor(null);
                      }}
                    >
                      Uncategorized
                    </button>
                    {projects.map(proj => (
                      <button
                        key={proj.id}
                        type="button"
                        className="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--tint)] border-t border-[var(--rule)]"
                        onClick={() => {
                          onMoveSession(s.id, proj.id);
                          setMoveFor(null);
                        }}
                      >
                        {proj.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {selectedProjectId && activeList.length === 0 && (
            <div className="px-3.5 py-3 text-[11px] text-[var(--dim)]">No active sessions</div>
          )}
          {archivedList.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setArchivedOpen(v => !v)}
                className="w-full text-left px-3.5 py-2.5 border-b border-[var(--rule)] font-mono text-[10px] tracking-widest text-[var(--dim)] hover:text-[var(--text)]"
              >
                › ARCHIVED ({archivedList.length})
              </button>
              {archivedOpen && archivedList.map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--rule)] text-[var(--dim)] group">
                  <span className="truncate flex-1 text-[12px]">{sessionTitle(s)}</span>
                  <button type="button" className="opacity-0 group-hover:opacity-100 cd-btn-outline" onClick={() => onReopenSession(s.id)}>REOPEN</button>
                  <button type="button" className="opacity-0 group-hover:opacity-100 cd-btn-outline" onClick={() => onDeleteSession(s.id)}>DELETE</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
