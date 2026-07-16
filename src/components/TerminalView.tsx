import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewHandle {
  write: (data: string) => void;
  clear: () => void;
  fit: () => void;
  focus: () => void;
  getSize: () => { cols: number; rows: number };
}

interface TerminalViewProps {
  onResize?: (cols: number, rows: number) => void;
  onData?: (data: string) => void;
}

const THEME = {
  background: '#0D0D0D',
  foreground: '#E8E8E8',
  cursor: '#D4A843',
  cursorAccent: '#0D0D0D',
  selectionBackground: '#D4A84340',
  black: '#0D0D0D',
  red: '#E05C5C',
  green: '#4CAF7D',
  yellow: '#D4A843',
  blue: '#5B8DEF',
  magenta: '#B583D8',
  cyan: '#5BC6D8',
  white: '#E8E8E8',
  brightBlack: '#4A4A4A',
  brightRed: '#E88080',
  brightGreen: '#6FCB9A',
  brightYellow: '#E0BD66',
  brightBlue: '#7EA6F5',
  brightMagenta: '#C89DE3',
  brightCyan: '#7ED4E3',
  brightWhite: '#FFFFFF',
};

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onResize, onData },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onResizeRef = useRef(onResize);
  const onDataRef = useRef(onData);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onDataRef.current = onData; }, [onData]);

  useImperativeHandle(ref, () => ({
    write: (data: string) => termRef.current?.write(data),
    clear: () => termRef.current?.clear(),
    fit: () => fitAddonRef.current?.fit(),
    focus: () => termRef.current?.focus(),
    getSize: () => ({
      cols: termRef.current?.cols || 80,
      rows: termRef.current?.rows || 30,
    }),
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      letterSpacing: 0.2,
      theme: THEME,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Stream every keystroke typed while the terminal is focused straight to the PTY —
    // this is what makes it a *real* terminal instead of a line-based chat input.
    const dataDisposable = term.onData(data => onDataRef.current?.(data));

    const textarea = term.textarea;
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);
    textarea?.addEventListener('focus', handleFocus);
    textarea?.addEventListener('blur', handleBlur);

    let lastCols = term.cols;
    let lastRows = term.rows;
    let rafHandle: number | null = null;

    const resizeObserver = new ResizeObserver(() => {
      // Coalesce rapid-fire observer callbacks (e.g. during window drag) into one fit per frame,
      // and only notify the backend when the size actually changed — this is what prevents the
      // fit -> scrollbar -> resize -> fit feedback loop that caused the flicker.
      if (rafHandle !== null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        try {
          fitAddon.fit();
          if (term.cols !== lastCols || term.rows !== lastRows) {
            lastCols = term.cols;
            lastRows = term.rows;
            onResizeRef.current?.(term.cols, term.rows);
          }
        } catch (e) {
          // Container may be briefly detached during layout changes; ignore.
        }
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      textarea?.removeEventListener('focus', handleFocus);
      textarea?.removeEventListener('blur', handleBlur);
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 min-w-0 p-3">
      <div
        onClick={() => termRef.current?.focus()}
        className={`h-full rounded-lg border transition-shadow duration-200 overflow-hidden bg-[#0D0D0D] pt-2 pb-2 pl-4 pr-4 ${
          isFocused
            ? 'border-[var(--color-accent)]/50 shadow-[0_0_0_1px_var(--color-accent)_inset,0_0_24px_-8px_var(--color-accent)]'
            : 'border-[var(--color-border-subtle)]'
        }`}
      >
        {/* No padding here — xterm measures this exact element to compute cols/rows,
            so any padding on it throws off the fit calculation and causes overflow/flicker. */}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
});
