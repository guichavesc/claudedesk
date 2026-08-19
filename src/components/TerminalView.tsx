import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { APPEARANCE_EVENT, adaptAnsiForLightTheme, isLightTheme, readTerminalFont, xtermThemeFromCss } from '../lib/appearance';

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

const THEME = () => xtermThemeFromCss();

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(function TerminalView(
  { onResize, onData },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onResizeRef = useRef(onResize);
  const onDataRef = useRef(onData);

  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onDataRef.current = onData; }, [onData]);

  useImperativeHandle(ref, () => ({
    write: (data: string) => termRef.current?.write(adaptAnsiForLightTheme(data)),
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
      fontFamily: `"${readTerminalFont()}", ui-monospace, monospace`,
      fontSize: 13,
      lineHeight: 1.5,
      letterSpacing: 0.2,
      theme: THEME(),
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

    const onAppearance = () => {
      term.options.theme = THEME();
      term.options.fontFamily = `"${readTerminalFont()}", ui-monospace, monospace`;
      // Force the CLI to repaint so truecolor spans go through adaptAnsiForLightTheme.
      const cols = term.cols;
      const rows = term.rows;
      if (cols > 2) {
        onResizeRef.current?.(cols - 1, rows);
        requestAnimationFrame(() => onResizeRef.current?.(cols, rows));
      }
    };
    window.addEventListener(APPEARANCE_EVENT, onAppearance);
    if (isLightTheme()) {
      requestAnimationFrame(onAppearance);
    }

    return () => {
      window.removeEventListener(APPEARANCE_EVENT, onAppearance);
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 min-w-0">
      <div
        onClick={() => termRef.current?.focus()}
        className="h-full overflow-hidden bg-[var(--bg)] pt-2 pb-2 pl-4 pr-4"
      >
        {/* No padding here — xterm measures this exact element to compute cols/rows,
            so any padding on it throws off the fit calculation and causes overflow/flicker. */}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
});
