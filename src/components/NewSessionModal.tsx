import React, { useState } from 'react';
import { Folder, FolderOpen, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { Profile, PermissionMode, PERMISSION_MODES, DEFAULT_PERMISSION_MODE_KEY, LAST_MODEL_KEY } from '../types';

interface NewSessionModalProps {
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (data: { profileId: string; workspacePath: string; model: string; permissionMode: PermissionMode }) => void;
}

const FALLBACK_MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
];

function splitPath(fullPath: string) {
  const parts = fullPath.split('/').filter(Boolean);
  const name = parts.pop() || fullPath;
  const parent = parts.length ? '/' + parts.join('/') : '/';
  return { name, parent };
}

export function NewSessionModal({ profiles, onClose, onSubmit }: NewSessionModalProps) {
  const [workspacePath, setWorkspacePath] = useState('');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [profileId, setProfileId] = useState(profiles[0]?.id || '');
  const [model, setModel] = useState(localStorage.getItem(LAST_MODEL_KEY) || 'claude-sonnet-4-6');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (localStorage.getItem(DEFAULT_PERMISSION_MODE_KEY) as PermissionMode) || 'default'
  );
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  React.useEffect(() => {
    window.api.getRecentWorkspaces().then(setRecentWorkspaces).catch(() => setRecentWorkspaces([]));
  }, []);

  // Fetch available models when profile changes
  React.useEffect(() => {
    if (!profileId) return;

    setLoadingModels(true);
    window.api.getAvailableModels(profileId)
      .then(result => {
        const models = result.models && result.models.length > 0 ? result.models : FALLBACK_MODELS;
        setAvailableModels(models);
        if (!models.includes(model)) {
          setModel(models[0]);
        }
      })
      .catch(error => {
        console.error('Error fetching models:', error);
        setAvailableModels(FALLBACK_MODELS);
        if (!FALLBACK_MODELS.includes(model)) {
          setModel(FALLBACK_MODELS[0]);
        }
      })
      .finally(() => {
        setLoadingModels(false);
      });
  }, [profileId]);

  const selectedProfile = profiles.find(p => p.id === profileId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspacePath || !profileId || !model) return;
    localStorage.setItem(LAST_MODEL_KEY, model);
    onSubmit({ profileId, workspacePath, model, permissionMode });
  };

  const handleSelectFolder = async () => {
    const path = await window.api.selectDirectory();
    if (path) {
      setWorkspacePath(path);
    }
  };

  const otherRecents = recentWorkspaces.filter(p => p !== workspacePath);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-[100] flex items-center justify-center">
      <div className="w-[520px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl p-6">
        <h2 className="text-[18px] text-[var(--color-text-primary)] font-semibold mb-6">New Session</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Workspace picker */}
          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Workspace</label>

            {workspacePath ? (
              <div className="flex items-center gap-3 bg-[var(--color-bg-base)] border border-[var(--color-accent)]/40 rounded-lg p-3">
                <div className="w-9 h-9 rounded-md bg-[var(--color-accent)]/15 flex items-center justify-center shrink-0">
                  <FolderOpen size={18} className="text-[var(--color-accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate" title={workspacePath}>
                    {splitPath(workspacePath).name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-dim)] truncate" title={workspacePath}>
                    {splitPath(workspacePath).parent}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  className="shrink-0 px-2.5 py-1.5 text-[11px] font-medium bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] hover:border-[var(--color-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSelectFolder}
                className="flex items-center gap-3 bg-[var(--color-bg-base)] border border-dashed border-[var(--color-border-default)] hover:border-[var(--color-accent)] rounded-lg p-4 transition-colors group"
              >
                <div className="w-9 h-9 rounded-md bg-[var(--color-bg-hover)] flex items-center justify-center shrink-0 group-hover:bg-[var(--color-accent)]/15 transition-colors">
                  <Folder size={18} className="text-[var(--color-text-dim)] group-hover:text-[var(--color-accent)] transition-colors" />
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[13px] font-medium text-[var(--color-text-primary)]">Choose a folder…</span>
                  <span className="text-[11px] text-[var(--color-text-dim)]">Pick the workspace this session will run in</span>
                </div>
              </button>
            )}

            {otherRecents.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold px-0.5">
                  <Clock size={10} />
                  <span>Recent</span>
                </div>
                <div className="flex flex-col gap-0.5 max-h-[132px] overflow-y-auto no-scrollbar">
                  {otherRecents.map(path => {
                    const { name, parent } = splitPath(path);
                    return (
                      <button
                        key={path}
                        type="button"
                        onClick={() => setWorkspacePath(path)}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded text-left hover:bg-[var(--color-bg-hover)] transition-colors group"
                        title={path}
                      >
                        <Folder size={13} className="text-[var(--color-text-dim)] group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
                        <span className="text-[12px] text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] truncate">{name}</span>
                        <span className="text-[11px] text-[var(--color-text-dim)] truncate">{parent}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Profile</label>
            <select 
              value={profileId} 
              onChange={e => setProfileId(e.target.value)}
              className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors"
            >
              <option value="" disabled>Select Profile</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Advanced options — model & permission mode can be changed later from the terminal's status bar too */}
          <div className="flex flex-col gap-3 -mt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(prev => !prev)}
              className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors self-start font-ui uppercase tracking-wider font-semibold"
            >
              {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Advanced Options</span>
              {!showAdvanced && (
                <span className="text-[var(--color-text-dim)] font-normal normal-case tracking-normal ml-1">
                  ({model} · {PERMISSION_MODES.find(m => m.value === permissionMode)?.label})
                </span>
              )}
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-5 pl-0.5 animate-[fadeIn_0.15s_ease-out]">
                <div className="flex flex-col gap-2">
                  <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">
                    Model
                    {selectedProfile && (
                      <span className="ml-2 text-[var(--color-text-dim)] font-normal normal-case">
                        ({selectedProfile.auth_type === 'subscription' ? 'Subscription' : 'API Key'})
                      </span>
                    )}
                  </label>
                  <select 
                    value={model} 
                    onChange={e => setModel(e.target.value)}
                    disabled={loadingModels}
                    className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
                  >
                    {loadingModels ? (
                      <option>Loading models...</option>
                    ) : availableModels.length > 0 ? (
                      availableModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))
                    ) : (
                      <option>No models available</option>
                    )}
                  </select>
                  <p className="text-[11px] text-[var(--color-text-dim)]">
                    You can also switch models from within the terminal at any time.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Permission Mode</label>
                  <select 
                    value={permissionMode} 
                    onChange={e => setPermissionMode(e.target.value as PermissionMode)}
                    className="bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-3 py-2 rounded text-[13px] font-mono text-[var(--color-text-primary)] transition-colors"
                  >
                    {PERMISSION_MODES.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[var(--color-text-dim)]">
                    {PERMISSION_MODES.find(m => m.value === permissionMode)?.description} — also changeable later from the status bar.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!workspacePath || !profileId || !model}
              className="px-4 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
