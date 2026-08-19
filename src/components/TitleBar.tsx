import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import faviconUrl from '/favicon.svg?url';
import { Profile, profileProvider, providerDisplayName } from '../types';

interface TitleBarProps {
  profiles: Profile[];
  activeProfileId: string | null;
  onSelectProfile: (id: string) => void;
  onNewProfile: () => void;
  onOpenSwitcher: () => void;
  onOpenSettings: () => void;
}

function initial(name: string) {
  return (name.trim()[0] || '?').toUpperCase();
}

export function TitleBar({
  profiles,
  activeProfileId,
  onSelectProfile,
  onNewProfile,
  onOpenSwitcher,
  onOpenSettings,
}: TitleBarProps) {
  const isMac = navigator.userAgent.includes('Mac');
  const active = profiles.find(p => p.id === activeProfileId) || profiles[0];
  const others = profiles.filter(p => p.id !== active?.id);

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.non-draggable')) return;
    window.api.maximizeWindow();
  };

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="h-[46px] bg-[var(--surface)] flex items-center gap-3.5 px-3 shrink-0 border-b-2 border-[var(--strong)] draggable select-none"
    >
      {isMac && <div className="w-[72px] shrink-0" />}
      {!isMac && (
        <div className="flex gap-[7px] shrink-0">
          <span className="w-[11px] h-[11px] rounded-full bg-[#ff5f57] block" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#febc2e] block" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#28c840] block" />
        </div>
      )}

      <span className="font-mono text-[11px] font-bold tracking-[0.24em] text-[var(--dim)] ml-2">CLAUDEDESK</span>
      <img src={faviconUrl} alt="" width={12} height={12} className="opacity-0 w-0" draggable={false} />

      <div className="w-px h-5 bg-[var(--rule)]" />

      <div className="non-draggable flex items-center gap-2 min-w-0">
        {active && (
          <button
            type="button"
            onClick={() => onSelectProfile(active.id)}
            className="flex items-center gap-2 border-2 border-[var(--strong)] px-2.5 py-1 hover:border-[var(--accent)]"
            title={`${active.name} · ${providerDisplayName(profileProvider(active))}`}
          >
            <span className="w-4 h-4 bg-[var(--accent)] text-white font-mono text-[9px] font-bold flex items-center justify-center">
              {initial(active.name)}
            </span>
            <span className="font-mono text-[11px] tracking-wider uppercase truncate max-w-[140px]">{active.name}</span>
          </button>
        )}
        {others.slice(0, 3).map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectProfile(p.id)}
            className="font-mono text-[9.5px] tracking-widest px-2 py-1 border border-[var(--rule)] text-[var(--dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] uppercase truncate max-w-[120px]"
            title={p.name}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={onNewProfile}
          className="font-mono text-[9.5px] tracking-widest px-2 py-1 border border-dashed border-[var(--rule)] text-[var(--dim)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          + PROFILE
        </button>
      </div>

      <div className="flex-1 min-w-[12px] h-full" />

      <div className="non-draggable flex items-center gap-2.5 font-mono text-[10px] tracking-widest text-[var(--dim)]">
        <button type="button" onClick={onOpenSwitcher} className="border border-[var(--rule)] px-2 py-1 hover:border-[var(--accent)] hover:text-[var(--accent)]">
          ⌘K SWITCH
        </button>
        <button type="button" onClick={onOpenSettings} className="border border-[var(--rule)] px-2 py-1 hover:border-[var(--accent)] hover:text-[var(--accent)]">
          SETTINGS
        </button>
        {!isMac && (
          <>
            <button onClick={() => window.api.minimizeWindow()} className="h-full px-2 hover:bg-[var(--sel)]">
              <Minus size={14} />
            </button>
            <button onClick={() => window.api.maximizeWindow()} className="h-full px-2 hover:bg-[var(--sel)]">
              <Square size={12} />
            </button>
            <button onClick={() => window.api.closeWindow()} className="h-full px-2 hover:bg-[var(--delfg)] hover:text-white">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
