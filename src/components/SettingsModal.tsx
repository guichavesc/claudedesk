import React, { useEffect, useState } from 'react';
import { Trash2, Blocks } from 'lucide-react';
import {
  Profile,
  Project,
  Session,
  PermissionMode,
  PERMISSION_MODES,
  DEFAULT_PERMISSION_MODE_KEY,
  providerDisplayName,
  profileProvider,
  isSessionActive,
} from '../types';
import { ProfileConfigModal } from './ProfileConfigModal';
import {
  ThemePref,
  TerminalFont,
  TERMINAL_FONTS,
  applyAppearance,
  readThemePref,
  readTerminalFont,
  readBool,
  APPEARANCE_EVENT,
  OFFER_PROFILE_ON_LIMIT_KEY,
  SHOW_AGENT_BADGE_KEY,
  GROUP_ARCHIVED_KEY,
} from '../lib/appearance';

type Tab = 'profiles' | 'projects' | 'mcp' | 'appearance';

interface SettingsModalProps {
  profiles: Profile[];
  projects: Project[];
  sessions: Session[];
  initialTab?: Tab;
  onClose: () => void;
  onReload: () => void;
  onNewProfile: () => void;
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-[34px] h-[18px] flex items-center p-0.5 ${on ? 'bg-[var(--accent)] justify-end' : 'border-2 border-[var(--strong)] justify-start'}`}
    >
      <span className={`block ${on ? 'w-3.5 h-3.5 bg-white' : 'w-3 h-3 bg-[var(--strong)]'}`} />
    </button>
  );
}

export function SettingsModal({
  profiles,
  projects,
  sessions,
  initialTab = 'profiles',
  onClose,
  onReload,
  onNewProfile,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [defaultMode, setDefaultMode] = useState<PermissionMode>(
    (localStorage.getItem(DEFAULT_PERMISSION_MODE_KEY) as PermissionMode) || 'default',
  );
  const [version, setVersion] = useState('');
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [configuringProfile, setConfiguringProfile] = useState<Profile | null>(null);
  const [theme, setTheme] = useState<ThemePref>(readThemePref());
  const [font, setFont] = useState<TerminalFont>(readTerminalFont());
  const [offerOnLimit, setOfferOnLimit] = useState(readBool(OFFER_PROFILE_ON_LIMIT_KEY, true));
  const [showBadge, setShowBadge] = useState(readBool(SHOW_AGENT_BADGE_KEY, true));
  const [groupArchived, setGroupArchived] = useState(readBool(GROUP_ARCHIVED_KEY, false));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mcpProfileId, setMcpProfileId] = useState(profiles[0]?.id || '');

  useEffect(() => {
    window.api.getAppVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const handleDeleteProfile = async (profileId: string, profileName: string) => {
    if (!confirm(`Delete profile "${profileName}"? This removes associated credentials and config files.`)) return;
    setDeletingProfileId(profileId);
    try {
      const result = await window.api.deleteProfile(profileId);
      if (result.success) onReload();
      else alert(result.message || 'Failed to delete profile');
    } catch {
      alert('Error deleting profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profiles', label: 'Profiles' },
    { id: 'projects', label: 'Projects' },
    { id: 'mcp', label: 'MCP & Plugins' },
    { id: 'appearance', label: 'Appearance' },
  ];

  const sessionCount = (profileId: string) => sessions.filter(s => s.profile_id === profileId && isSessionActive(s)).length;

  return (
    <div className="cd-scrim" onClick={onClose}>
      <div className="cd-dialog w-[960px] max-h-[84vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-5 px-5 h-12 border-b-2 border-[var(--strong)]">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`h-full font-mono text-[11px] tracking-widest ${
                tab === t.id ? 'text-[var(--text)] border-b-2 border-[var(--accent)] mb-[-2px]' : 'text-[var(--dim)] hover:text-[var(--accent)]'
              }`}
            >
              {t.label.toUpperCase()}
            </button>
          ))}
          {tab === 'profiles' && (
            <button type="button" onClick={onNewProfile} className="ml-auto cd-btn-primary py-1.5 px-3">
              + New profile
            </button>
          )}
        </div>

        <div className="overflow-y-auto no-scrollbar max-h-[calc(84vh-96px)]">
          {tab === 'profiles' && (
            <div>
              <div className="grid grid-cols-[1.4fr_0.8fr_1fr_0.6fr_0.8fr] font-mono text-[9.5px] tracking-widest text-[var(--dim)] border-b-2 border-[var(--strong)]">
                <span className="px-5 py-2.5">PROFILE</span>
                <span className="px-3 py-2.5">AGENT</span>
                <span className="px-3 py-2.5">AUTH</span>
                <span className="px-3 py-2.5">SESSIONS</span>
                <span className="px-3 py-2.5" />
              </div>
              {profiles.map(p => (
                <div key={p.id} className="grid grid-cols-[1.4fr_0.8fr_1fr_0.6fr_0.8fr] items-center border-b border-[var(--rule)] hover:bg-[var(--tint)]">
                  <span className="px-5 py-3.5 text-[13px] font-semibold flex items-center gap-2">
                    <span className="w-[18px] h-[18px] bg-[var(--accent)] text-white font-mono text-[9px] flex items-center justify-center">
                      {(p.name[0] || '?').toUpperCase()}
                    </span>
                    {p.name}
                  </span>
                  <span className="px-3 py-3.5 font-mono text-[11px]">{providerDisplayName(profileProvider(p)).toUpperCase()}</span>
                  <span className="px-3 py-3.5 font-mono text-[11px] text-[var(--dim)]">{p.auth_type}</span>
                  <span className="px-3 py-3.5 font-mono text-[11px]">{sessionCount(p.id)}</span>
                  <span className="px-3 py-3.5 flex gap-1 justify-end">
                    {profileProvider(p) === 'claude' && (
                      <button type="button" onClick={() => setConfiguringProfile(p)} className="p-1 hover:text-[var(--accent)]" title="MCP">
                        <Blocks size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteProfile(p.id, p.name)}
                      disabled={deletingProfileId === p.id}
                      className="p-1 hover:text-[var(--delfg)]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {profiles.length === 0 && (
                <div className="px-5 py-4 text-[12px] text-[var(--dim)]">No profiles created</div>
              )}
              <div className="px-5 py-4 flex flex-col gap-2 border-t border-[var(--rule)]">
                <span className="cd-kicker">Default permission mode</span>
                <select
                  value={defaultMode}
                  onChange={e => {
                    const mode = e.target.value as PermissionMode;
                    setDefaultMode(mode);
                    localStorage.setItem(DEFAULT_PERMISSION_MODE_KEY, mode);
                  }}
                  className="cd-select max-w-xs"
                >
                  {PERMISSION_MODES.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <span className="font-mono text-[10px] text-[var(--dim)]">ClaudeDesk{version ? ` · v${version}` : ''}</span>
              </div>
            </div>
          )}

          {tab === 'projects' && (
            <div>
              {projects.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--rule)] hover:bg-[var(--tint)]">
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      className="cd-input flex-1"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={async () => {
                        if (renameValue.trim()) await window.api.renameProject(p.id, renameValue.trim());
                        setRenamingId(null);
                        onReload();
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          if (renameValue.trim()) await window.api.renameProject(p.id, renameValue.trim());
                          setRenamingId(null);
                          onReload();
                        } else if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="flex-1 text-left text-[13px] font-semibold" onDoubleClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}>
                      {p.name}
                    </button>
                  )}
                  <span className="font-mono text-[10px] text-[var(--dim)]">
                    {sessions.filter(s => s.project_id === p.id && isSessionActive(s)).length} sessions
                  </span>
                  <button
                    type="button"
                    className="cd-btn-outline"
                    onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                  >
                    RENAME
                  </button>
                  <button
                    type="button"
                    className="cd-btn-outline"
                    onClick={async () => {
                      if (!confirm(`Delete project "${p.name}"? Sessions become uncategorized.`)) return;
                      const result = await window.api.deleteProject(p.id);
                      if (!result.success) alert(result.message);
                      else onReload();
                    }}
                  >
                    DELETE
                  </button>
                </div>
              ))}
              {projects.length === 0 && (
                <div className="px-5 py-4 text-[12px] text-[var(--dim)]">No named projects yet</div>
              )}
            </div>
          )}

          {tab === 'mcp' && (
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-end justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[17px] font-extrabold">MCP & plugins</span>
                  <span className="font-mono text-[10px] tracking-widest text-[var(--dim)]">PER PROFILE · RESTART TO APPLY</span>
                </div>
                <select value={mcpProfileId} onChange={e => setMcpProfileId(e.target.value)} className="cd-select max-w-[220px]">
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {mcpProfileId && profiles.find(p => p.id === mcpProfileId) && (
                <button
                  type="button"
                  className="cd-btn-outline self-start"
                  onClick={() => setConfiguringProfile(profiles.find(p => p.id === mcpProfileId)!)}
                >
                  Open MCP & plugins for this profile
                </button>
              )}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="p-5 flex flex-col gap-[18px] max-w-[420px]">
              <div>
                <div className="text-[17px] font-extrabold">Appearance</div>
                <div className="font-mono text-[10px] tracking-widest text-[var(--dim)]">APPLIES TO ALL WINDOWS</div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="cd-kicker">Theme</span>
                <div className="flex border-2 border-[var(--strong)]">
                  {(['dark', 'light', 'system'] as ThemePref[]).map((t, i) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTheme(t);
                        applyAppearance({ theme: t, font });
                      }}
                      className={`flex-1 font-mono text-[11px] tracking-widest py-2.5 ${i ? 'border-l-2 border-[var(--strong)]' : ''} ${
                        theme === t ? 'bg-[var(--tint)]' : 'hover:bg-[var(--tint)]'
                      }`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="cd-kicker">Terminal typeface</span>
                <div className="flex flex-col border border-[var(--rule)]">
                  {TERMINAL_FONTS.map((f, i) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFont(f);
                        applyAppearance({ theme, font: f });
                      }}
                      className={`text-left px-3 py-2.5 text-[12px] ${i ? 'border-t border-[var(--rule)]' : ''} ${
                        font === f ? 'bg-[var(--tint)]' : 'hover:bg-[var(--tint)]'
                      }`}
                      style={{ fontFamily: `"${f}", ui-monospace, monospace` }}
                    >
                      {f} — 2.0.435
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="cd-kicker">Behaviour</span>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]">Offer another profile when a limit hits</span>
                  <Toggle on={offerOnLimit} onToggle={() => {
                    const next = !offerOnLimit;
                    setOfferOnLimit(next);
                    localStorage.setItem(OFFER_PROFILE_ON_LIMIT_KEY, next ? 'true' : 'false');
                  }} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]">Show agent badge on every session</span>
                  <Toggle on={showBadge} onToggle={() => {
                    const next = !showBadge;
                    setShowBadge(next);
                    localStorage.setItem(SHOW_AGENT_BADGE_KEY, next ? 'true' : 'false');
                    window.dispatchEvent(new Event(APPEARANCE_EVENT));
                  }} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[12.5px] ${groupArchived ? '' : 'text-[var(--dim)]'}`}>Group archived sessions per project</span>
                  <Toggle on={groupArchived} onToggle={() => {
                    const next = !groupArchived;
                    setGroupArchived(next);
                    localStorage.setItem(GROUP_ARCHIVED_KEY, next ? 'true' : 'false');
                  }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {configuringProfile && (
        <ProfileConfigModal profile={configuringProfile} onClose={() => setConfiguringProfile(null)} />
      )}
    </div>
  );
}
