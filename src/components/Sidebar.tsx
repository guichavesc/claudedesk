import React, { useState } from 'react';
import { User, Terminal, Settings, Plus, Trash2 } from 'lucide-react';
import { Profile, Session, sessionColor, sessionDisplayName } from '../types';

interface SidebarProps {
  profiles: Profile[];
  sessions: Session[];
  activeSessionId: string | null;
  width: number;
  onSelectSession: (sessionId: string) => void;
  onReload: () => void;
  onNewProfile: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({ profiles, sessions, activeSessionId, width, onSelectSession, onNewProfile, onReload, onOpenSettings }: SidebarProps) {
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  const handleDeleteProfile = async (profileId: string, profileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    console.log('[Delete Profile] Starting deletion for:', { profileId, profileName });
    
    if (!confirm(`Are you sure you want to delete the profile "${profileName}"? This will remove all associated credentials and config files.`)) {
      console.log('[Delete Profile] User cancelled deletion');
      return;
    }

    console.log('[Delete Profile] User confirmed, proceeding with deletion');
    setDeletingProfileId(profileId);
    
    try {
      console.log('[Delete Profile] Calling API deleteProfile...');
      const result = await window.api.deleteProfile(profileId);
      console.log('[Delete Profile] API response:', result);
      
      if (result.success) {
        console.log('[Delete Profile] Success! Reloading data...');
        onReload();
      } else {
        console.error('[Delete Profile] Failed:', result.message);
        alert(result.message || 'Failed to delete profile');
      }
    } catch (error) {
      console.error('[Delete Profile] Exception caught:', error);
      alert('Error deleting profile');
    } finally {
      setDeletingProfileId(null);
      console.log('[Delete Profile] Deletion process complete');
    }
  };

  return (
    <div
      style={{ width }}
      className="bg-[var(--color-bg-surface)] border-r border-[var(--color-border-subtle)] flex flex-col shrink-0 min-w-0 overflow-hidden"
    >
      
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 no-scrollbar">
        {/* Profiles Section */}
        <div className="mb-6">
          <div className="px-4 mb-2 flex items-center justify-between group">
            <span className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Profiles</span>
            <button 
              onClick={onNewProfile}
              className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 transition-all"
            >
              <Plus size={14} />
            </button>
          </div>
          
          <div className="flex flex-col gap-0.5">
            {profiles.map(p => (
              <div key={p.id} className="px-4 py-1.5 flex items-center gap-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors text-[12px] group/item">
                <User size={14} />
                <span className="truncate flex-1">{p.name}</span>
                <button
                  onClick={(e) => handleDeleteProfile(p.id, p.name, e)}
                  disabled={deletingProfileId === p.id}
                  className="opacity-0 group-hover/item:opacity-100 hover:text-red-500 transition-all disabled:opacity-50"
                  title="Delete profile"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {profiles.length === 0 && (
              <div className="px-4 py-1.5 text-[11px] text-[var(--color-text-dim)]">No profiles created</div>
            )}
          </div>
        </div>

        {/* Sessions Section */}
        <div>
          <div className="px-4 mb-2">
            <span className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Sessions</span>
          </div>
          
          <div className="flex flex-col gap-0.5">
            {sessions.map(s => {
              const isActive = s.id === activeSessionId;
              const color = sessionColor(s);
              return (
                <button
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  title={`${sessionDisplayName(s)}\n${s.workspace_path}`}
                  className={`px-4 py-1.5 flex items-center gap-2 w-full text-left cursor-pointer transition-colors text-[12px] border-l-2 ${
                    isActive
                      ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                  }`}
                  style={isActive ? { borderLeftColor: color } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color, opacity: isActive ? 1 : 0.7 }}
                  />
                  <Terminal size={14} className="shrink-0" style={isActive ? { color } : undefined} />
                  <span className="truncate">{sessionDisplayName(s)}</span>
                </button>
              );
            })}
            {sessions.length === 0 && (
              <div className="px-4 py-1.5 text-[11px] text-[var(--color-text-dim)]">No sessions yet</div>
            )}
          </div>
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
