import React, { useEffect, useState } from 'react';
import { X, Trash2, Info, Blocks } from 'lucide-react';
import { Profile, PermissionMode, PERMISSION_MODES, DEFAULT_PERMISSION_MODE_KEY } from '../types';
import { ProfileConfigModal } from './ProfileConfigModal';

interface SettingsModalProps {
  profiles: Profile[];
  onClose: () => void;
  onReload: () => void;
}

export function SettingsModal({ profiles, onClose, onReload }: SettingsModalProps) {
  const [defaultMode, setDefaultMode] = useState<PermissionMode>(
    (localStorage.getItem(DEFAULT_PERMISSION_MODE_KEY) as PermissionMode) || 'default'
  );
  const [version, setVersion] = useState<string>('');
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);
  const [configuringProfile, setConfiguringProfile] = useState<Profile | null>(null);

  useEffect(() => {
    window.api.getAppVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const handleDefaultModeChange = (mode: PermissionMode) => {
    setDefaultMode(mode);
    localStorage.setItem(DEFAULT_PERMISSION_MODE_KEY, mode);
  };

  const handleDeleteProfile = async (profileId: string, profileName: string) => {
    if (!confirm(`Are you sure you want to delete the profile "${profileName}"? This will remove all associated credentials and config files.`)) {
      return;
    }
    setDeletingProfileId(profileId);
    try {
      const result = await window.api.deleteProfile(profileId);
      if (result.success) {
        onReload();
      } else {
        alert(result.message || 'Failed to delete profile');
      }
    } catch (error) {
      alert('Error deleting profile');
    } finally {
      setDeletingProfileId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-[100] flex items-center justify-center">
      <div className="w-[520px] max-h-[80vh] flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[18px] text-[var(--color-text-primary)] font-semibold">Settings</h2>
          <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto no-scrollbar pr-1">
          {/* Preferences */}
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
              Default Permission Mode
            </label>
            <select
              value={defaultMode}
              onChange={e => handleDefaultModeChange(e.target.value as PermissionMode)}
              className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors"
            >
              {PERMISSION_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--color-text-dim)]">
              Used to pre-select the permission mode when creating a new session.
            </p>
          </div>

          {/* Profiles */}
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
              Profiles
            </label>
            <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded overflow-hidden">
              {profiles.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-[var(--color-text-dim)]">No profiles created</div>
              )}
              {profiles.map(p => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 text-[12px] text-[var(--color-text-secondary)] group">
                  <div className="flex flex-col">
                    <span className="text-[var(--color-text-primary)]">{p.name}</span>
                    <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wide">{p.auth_type}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => setConfiguringProfile(p)}
                      className="p-1 hover:text-[var(--color-accent)] transition-colors"
                      title="MCP servers & plugins"
                    >
                      <Blocks size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(p.id, p.name)}
                      disabled={deletingProfileId === p.id}
                      className="p-1 hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Delete profile"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
              About
            </label>
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-dim)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded px-3 py-2">
              <Info size={13} />
              <span>ClaudeDesk{version ? ` · v${version}` : ''}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all">
            Done
          </button>
        </div>
      </div>

      {configuringProfile && (
        <ProfileConfigModal profile={configuringProfile} onClose={() => setConfiguringProfile(null)} />
      )}
    </div>
  );
}
