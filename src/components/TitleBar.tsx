import React from 'react';
import { Minus, Square, X } from 'lucide-react';

export function TitleBar() {
  const isMac = navigator.userAgent.includes('Mac');

  return (
    <div className="h-[36px] bg-[var(--color-bg-surface)] flex items-center justify-between draggable select-none z-50 shrink-0">
      <div className="flex items-center h-full px-4">
        {/* On Mac, traffic lights are here, so we add padding. On Windows, nothing. */}
        {isMac && <div className="w-[72px]" />} 
      </div>
      
      <div className="font-ui text-[11px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold flex items-center gap-2">
        <img src="/favicon.svg" alt="" width={14} height={14} className="rounded-[3px]" draggable={false} />
        ClaudeDesk
      </div>

      <div className="flex h-full non-draggable">
        {!isMac && (
          <>
            <button onClick={() => window.api.minimizeWindow()} className="h-full px-4 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors">
              <Minus size={14} />
            </button>
            <button onClick={() => window.api.maximizeWindow()} className="h-full px-4 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] transition-colors">
              <Square size={12} />
            </button>
            <button onClick={() => window.api.closeWindow()} className="h-full px-4 hover:bg-[var(--color-status-red)] hover:text-white text-[var(--color-text-secondary)] transition-colors">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
