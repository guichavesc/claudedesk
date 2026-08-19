import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  Terminal,
  Settings,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Archive,
  RotateCcw,
} from 'lucide-react';
import { Profile, Session, isSessionActive, sessionColor, sessionDisplayName } from '../types';

interface SidebarProps {
  profiles: Profile[];
  sessions: Session[];
  activeSessionId: string | null;
  focusedProfileId: string | null;
  width: number;
  onSelectSession: (sessionId: string) => void;
  onFocusProfile: (profileId: string) => void;
  onClearProfileFocus: () => void;
  onArchiveSession: (sessionId: string) => void;
  onReopenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onReload: () => void;
  onNewProfile: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  profiles,
  sessions,
  activeSessionId,
  focusedProfileId,
  width,
  onSelectSession,
  onFocusProfile,
  onClearProfileFocus,
  onArchiveSession,
  onReopenSession,
  onDeleteSession,
  onRenameSession,
  onNewProfile,
  onReload,
  onOpenSettings,
}: SidebarProps) {
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [collapsedProfiles, setCollapsedProfiles] = useState<Record<string, boolean>>({});
  const [expandedArchived, setExpandedArchived] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const sessionsByProfile = useMemo(() => {
    const map = new Map<string, { active: Session[]; archived: Session[] }>();
    for (const p of profiles) {
      map.set(p.id, { active: [], archived: [] });
    }
    for (const s of sessions) {
      let bucket = map.get(s.profile_id);
      if (!bucket) {
        bucket = { active: [], archived: [] };
        map.set(s.profile_id, bucket);
      }
      if (isSessionActive(s)) bucket.active.push(s);
      else bucket.archived.push(s);
    }
    return map;
  }, [profiles, sessions]);

  const visibleProfiles = focusedProfileId
    ? profiles.filter(p => p.id === focusedProfileId)
    : profiles;

  const focusedProfile = focusedProfileId
    ? profiles.find(p => p.id === focusedProfileId)
    : null;

  const handleDeleteProfile = async (profileId: string, profileName: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm(`Are you sure you want to delete the profile "${profileName}"? This will remove all associated credentials and config files.`)) {
      return;
    }

    setDeletingProfileId(profileId);

    try {
      const result = await window.api.deleteProfile(profileId);
      if (result.success) {
        if (focusedProfileId === profileId) onClearProfileFocus();
        onReload();
      } else {
        alert(result.message || 'Failed to delete profile');
      }
    } catch {
      alert('Error deleting profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  const toggleProfileCollapsed = (profileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedProfiles(prev => ({ ...prev, [profileId]: !prev[profileId] }));
  };

  const toggleArchivedExpanded = (profileId: string) => {
    setExpandedArchived(prev => ({ ...prev, [profileId]: !prev[profileId] }));
  };

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const startRename = (session: Session) => {
    setEditingId(session.id);
    setEditValue(session.title?.trim() || '');
  };

  const commitRename = () => {
    if (!editingId) return;
    const id = editingId;
    const value = editValue;
    setEditingId(null);
    onRenameSession(id, value);
  };

  const cancelRename = () => setEditingId(null);

  return (
    <div
      style={{ width }}
      className="bg-[var(--color-bg-surface)] border-r border-[var(--color-border-subtle)] flex flex-col shrink-0 min-w-0 overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 no-scrollbar">
        <div className="px-4 mb-2 flex items-center justify-between group">
          <span className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
            Sessions
          </span>
          <button
            onClick={onNewProfile}
            className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 transition-all"
            title="New profile"
          >
            <Plus size={14} />
          </button>
        </div>

        {focusedProfile && (
          <div className="px-4 mb-3">
            <button
              type="button"
              onClick={onClearProfileFocus}
              className="text-[11px] text-[var(--color-accent)] hover:underline"
            >
              ← All profiles
            </button>
            <div className="mt-1 text-[12px] text-[var(--color-text-secondary)] truncate">
              Focused: {focusedProfile.name}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {visibleProfiles.map(profile => {
            const bucket = sessionsByProfile.get(profile.id) || { active: [], archived: [] };
            const collapsed = !!collapsedProfiles[profile.id];
            const archivedOpen = !!expandedArchived[profile.id];
            const isFocused = focusedProfileId === profile.id;

            return (
              <div key={profile.id}>
                <div
                  className={`px-4 py-1.5 flex items-center gap-1.5 text-[12px] group/profile ${
                    isFocused
                      ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => toggleProfileCollapsed(profile.id, e)}
                    className="shrink-0 text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
                    title={collapsed ? 'Expand' : 'Collapse'}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onFocusProfile(profile.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                    title="Focus this profile"
                  >
                    <User size={14} className="shrink-0" />
                    <span className="truncate font-medium">{profile.name}</span>
                    <span className="text-[10px] text-[var(--color-text-dim)] shrink-0">
                      {bucket.active.length}
                    </span>
                  </button>
                  <button
                    onClick={(e) => handleDeleteProfile(profile.id, profile.name, e)}
                    disabled={deletingProfileId === profile.id}
                    className="opacity-0 group-hover/profile:opacity-100 hover:text-red-500 transition-all disabled:opacity-50 shrink-0"
                    title="Delete profile"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {!collapsed && (
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {bucket.active.map(s => {
                      const isActive = s.id === activeSessionId;
                      const color = sessionColor(s);
                      const isEditing = editingId === s.id;
                      return (
                        <div
                          key={s.id}
                          className={`pl-8 pr-2 py-1.5 flex items-center gap-2 w-full text-[12px] border-l-2 group/session ${
                            isActive
                              ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                              : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                          }`}
                          style={isActive ? { borderLeftColor: color } : undefined}
                        >
                          {isEditing ? (
                            <input
                              ref={editInputRef}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRename();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              className="flex-1 min-w-0 bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                              placeholder="Session title"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => onSelectSession(s.id)}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startRename(s);
                              }}
                              title={`${sessionDisplayName(s)}\n${s.workspace_path}\nDouble-click to rename`}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: color, opacity: isActive ? 1 : 0.7 }}
                              />
                              <Terminal size={14} className="shrink-0" style={isActive ? { color } : undefined} />
                              <span className="truncate">{sessionDisplayName(s)}</span>
                            </button>
                          )}
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={() => onArchiveSession(s.id)}
                              className="opacity-0 group-hover/session:opacity-100 text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] shrink-0 p-0.5"
                              title="Archive session"
                            >
                              <Archive size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {bucket.active.length === 0 && (
                      <div className="pl-8 pr-4 py-1 text-[11px] text-[var(--color-text-dim)]">
                        No active sessions
                      </div>
                    )}

                    {bucket.archived.length > 0 && (
                      <div className="mt-1">
                        <button
                          type="button"
                          onClick={() => toggleArchivedExpanded(profile.id)}
                          className="pl-8 pr-4 py-1 flex items-center gap-1.5 w-full text-left text-[11px] text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
                        >
                          {archivedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Archive size={12} />
                          <span>Archived ({bucket.archived.length})</span>
                        </button>

                        {archivedOpen && (
                          <div className="flex flex-col gap-0.5">
                            {bucket.archived.map(s => {
                              const color = sessionColor(s);
                              return (
                                <div
                                  key={s.id}
                                  className="pl-10 pr-2 py-1.5 flex items-center gap-2 w-full text-[12px] text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] group/archived"
                                >
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0 opacity-50"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="truncate flex-1" title={sessionDisplayName(s)}>
                                    {sessionDisplayName(s)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onReopenSession(s.id)}
                                    className="opacity-0 group-hover/archived:opacity-100 text-[var(--color-text-dim)] hover:text-[var(--color-accent)] shrink-0 p-0.5"
                                    title="Reopen session"
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteSession(s.id)}
                                    className="opacity-0 group-hover/archived:opacity-100 text-[var(--color-text-dim)] hover:text-red-500 shrink-0 p-0.5"
                                    title="Permanently delete"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {profiles.length === 0 && (
            <div className="px-4 py-1.5 text-[11px] text-[var(--color-text-dim)]">No profiles created</div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-[var(--color-border-subtle)]">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 w-full text-left text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors text-[12px]"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
