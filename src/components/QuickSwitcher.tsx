import React, { useEffect, useMemo, useState } from 'react';
import {
  Profile,
  Project,
  Session,
  isSessionActive,
  profileProvider,
  providerDisplayName,
  sessionTitle,
} from '../types';

interface QuickSwitcherProps {
  sessions: Session[];
  profiles: Profile[];
  projects: Project[];
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onMigrate: () => void;
  onNewSession: () => void;
}

export function QuickSwitcher({
  sessions,
  profiles,
  projects,
  onClose,
  onSelectSession,
  onMigrate,
  onNewSession,
}: QuickSwitcherProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const projectName = (id?: string | null) => {
    if (!id) return 'Uncategorized';
    return projects.find(p => p.id === id)?.name || 'Uncategorized';
  };

  const profile = (id: string) => profiles.find(p => p.id === id);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = sessions.filter(isSessionActive);
    if (!q) return active.slice(0, 8);
    return active.filter(s => {
      const title = sessionTitle(s).toLowerCase();
      const proj = projectName(s.project_id).toLowerCase();
      const agent = providerDisplayName(s.provider || profileProvider(profile(s.profile_id))).toLowerCase();
      return title.includes(q) || proj.includes(q) || agent.includes(q);
    }).slice(0, 12);
  }, [query, sessions, profiles, projects]);

  const actions = [
    { id: 'migrate', label: 'Migrate active session', shortcut: '⌘⇧M', run: onMigrate },
    { id: 'new', label: 'New session', shortcut: '⌘T', run: onNewSession },
  ];

  const total = matches.length + actions.length;

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(i => (i + 1) % Math.max(total, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(i => (i - 1 + Math.max(total, 1)) % Math.max(total, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (index < matches.length) {
          onSelectSession(matches[index].id);
          onClose();
        } else {
          actions[index - matches.length]?.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, matches, total, onClose, onSelectSession, onMigrate, onNewSession]);

  return (
    <div className="cd-scrim items-start pt-14" onClick={onClose}>
      <div className="cd-dialog w-[520px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b-2 border-[var(--strong)]">
          <span className="font-mono text-[13px] text-[var(--accent)]">›</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Switch session…"
            className="flex-1 bg-transparent outline-none font-mono text-[13.5px] text-[var(--text)]"
          />
          <span className="font-mono text-[9.5px] tracking-widest text-[var(--dim)] border border-[var(--rule)] px-1.5 py-0.5">ESC</span>
        </div>
        <div className="px-4 pt-2.5 pb-1.5 font-mono text-[9px] tracking-[0.14em] text-[var(--dim)]">SESSIONS</div>
        {matches.length === 0 && (
          <div className="px-4 py-2.5 text-[13px] text-[var(--dim)]">No matching sessions</div>
        )}
        {matches.map((s, i) => {
          const p = profile(s.profile_id);
          const selected = i === index;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelectSession(s.id);
                onClose();
              }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left ${
                selected ? 'bg-[var(--sel)] border-l-2 border-[var(--accent)]' : 'border-l-2 border-transparent'
              }`}
            >
              <span className={`w-1.5 h-1.5 shrink-0 ${selected ? 'bg-[var(--accent)]' : 'bg-[var(--dim)]'}`} />
              <span className={`flex-1 text-[13px] truncate ${selected ? 'font-semibold' : ''}`}>{sessionTitle(s)}</span>
              <span className="font-mono text-[9px] tracking-widest text-[var(--dim)]">
                {projectName(s.project_id).toUpperCase()} · {providerDisplayName(s.provider || profileProvider(p)).toUpperCase()}
              </span>
            </button>
          );
        })}
        <div className="px-4 pt-3 pb-1.5 font-mono text-[9px] tracking-[0.14em] text-[var(--dim)] border-t border-[var(--rule)]">ACTIONS</div>
        {actions.map((a, i) => {
          const selected = matches.length + i === index;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                a.run();
                onClose();
              }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-t border-[var(--rule)] ${
                selected ? 'bg-[var(--sel)]' : ''
              }`}
            >
              <span className="font-mono text-[11px] text-[var(--accent)]">{a.id === 'new' ? '+' : '→'}</span>
              <span className="flex-1 text-[13px]">{a.label}</span>
              <span className="font-mono text-[9.5px] text-[var(--dim)]">{a.shortcut}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
