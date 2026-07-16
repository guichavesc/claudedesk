import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Session, SESSION_COLORS, sessionColor, sessionDisplayName } from '../types';

interface TabsBarProps {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
}

export function TabsBar({ sessions, activeId, onSelect, onNew, onClose, onChangeColor }: TabsBarProps) {
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colorPickerFor) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColorPickerFor(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerFor(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [colorPickerFor]);

  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    onClose(sessionId);
  };

  return (
    <div className="h-[40px] bg-[var(--color-bg-base)] border-b border-[var(--color-bg-elevated)] flex shrink-0 items-end px-2 overflow-x-auto no-scrollbar select-none">
      {sessions.map((session) => {
        const isActive = session.id === activeId;
        const label = sessionDisplayName(session);
        const color = sessionColor(session);
        const isPickerOpen = colorPickerFor === session.id;

        return (
          <div
            key={session.id}
            onClick={() => onSelect(session.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setColorPickerFor(session.id);
            }}
            title={`${label} · ${session.model}\nRight-click to change color`}
            className={`
              relative h-[32px] pl-3 pr-8 flex items-center gap-2 cursor-pointer text-[12px] min-w-[160px] max-w-[280px] border-b-2
              transition-colors duration-150 ease-out group
              ${isActive
                ? 'text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
              }
            `}
            style={isActive ? {
              borderBottomColor: color,
              backgroundColor: `${color}18`,
            } : undefined}
          >
            {/* Color chip — click to recolor; also the main visual identity of the tab. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setColorPickerFor(isPickerOpen ? null : session.id);
              }}
              className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20 transition-transform ${
                isActive ? 'scale-110' : 'opacity-80 group-hover:opacity-100'
              }`}
              style={{ backgroundColor: color }}
              title="Change tab color"
            />
            <span className="truncate flex-1">{label}</span>
            <button
              onClick={(e) => handleClose(e, session.id)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-bg-base)] rounded p-0.5 transition-all"
              title="Close session"
            >
              <X size={12} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]" />
            </button>

            {isPickerOpen && (
              <div
                ref={pickerRef}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-full left-2 mt-1 z-50 flex items-center gap-1.5 p-2 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] shadow-2xl animate-[fadeIn_0.12s_ease-out]"
              >
                {SESSION_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      onChangeColor(session.id, c);
                      setColorPickerFor(null);
                    }}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                      c === color ? 'ring-2 ring-offset-1 ring-offset-[var(--color-bg-elevated)] ring-white/80' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="h-[32px] w-[32px] flex items-center justify-center text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors ml-1 rounded-t-sm"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
