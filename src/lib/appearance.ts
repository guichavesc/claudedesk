export const THEME_KEY = 'claudedesk:theme';
export const TERMINAL_FONT_KEY = 'claudedesk:terminalFont';
export const OFFER_PROFILE_ON_LIMIT_KEY = 'claudedesk:offerProfileOnLimit';
export const SHOW_AGENT_BADGE_KEY = 'claudedesk:showAgentBadge';
export const GROUP_ARCHIVED_KEY = 'claudedesk:groupArchivedPerProject';
export const SELECTED_PROJECT_KEY = 'claudedesk:selectedProjectId';
export const PROJECTS_PANE_KEY = 'claudedesk:projectsPaneOpen';
export const SESSIONS_PANE_KEY = 'claudedesk:sessionsPaneOpen';
export const APPEARANCE_EVENT = 'claudedesk:appearance';

export type ThemePref = 'dark' | 'light' | 'system';
export type TerminalFont = 'JetBrains Mono' | 'IBM Plex Mono' | 'Geist Mono';

export const TERMINAL_FONTS: TerminalFont[] = ['JetBrains Mono', 'IBM Plex Mono', 'Geist Mono'];

export function readThemePref(): ThemePref {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'dark';
}

export function readTerminalFont(): TerminalFont {
  const raw = localStorage.getItem(TERMINAL_FONT_KEY);
  if (raw === 'IBM Plex Mono' || raw === 'Geist Mono' || raw === 'JetBrains Mono') return raw;
  return 'JetBrains Mono';
}

export function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return fallback;
}

export function resolvedTheme(pref: ThemePref = readThemePref()): 'dark' | 'light' {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return pref;
}

export function applyAppearance(opts?: { theme?: ThemePref; font?: TerminalFont }) {
  const theme = opts?.theme ?? readThemePref();
  const font = opts?.font ?? readTerminalFont();
  if (opts?.theme) localStorage.setItem(THEME_KEY, opts.theme);
  if (opts?.font) localStorage.setItem(TERMINAL_FONT_KEY, opts.font);

  const resolved = resolvedTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.setProperty('--mono', `"${font}", ui-monospace, monospace`);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (readThemePref() === 'system') applyAppearance();
  });
}

/** ANSI palette plus chrome — light mode uses dark inks so cyan/blue hashes stay readable. */
export function xtermThemeFromCss() {
  const s = getComputedStyle(document.documentElement);
  const bg = s.getPropertyValue('--bg').trim() || '#171615';
  const text = s.getPropertyValue('--text').trim() || '#f3f2f2';
  const accent = s.getPropertyValue('--accent').trim() || '#ff563c';
  const tint = s.getPropertyValue('--tint').trim() || 'rgba(255,86,60,0.13)';
  const light = document.documentElement.dataset.theme === 'light';

  if (light) {
    return {
      background: bg,
      foreground: text,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: tint,
      black: '#201e1d',
      red: '#ae1800',
      green: '#1d6b38',
      yellow: '#8a5a00',
      blue: '#184a9c',
      magenta: '#6b2f9e',
      cyan: '#0b5c63',
      white: '#444141',
      brightBlack: '#2d2b2b',
      brightRed: '#c41e00',
      brightGreen: '#166433',
      brightYellow: '#7a4e00',
      brightBlue: '#0e3d86',
      brightMagenta: '#54247d',
      brightCyan: '#084c52',
      brightWhite: '#201e1d',
    };
  }

  return {
    background: bg,
    foreground: text,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: tint,
    black: '#171615',
    red: '#ff9783',
    green: '#8ed7a5',
    yellow: '#e0bd66',
    blue: '#7ea6f5',
    magenta: '#c89de3',
    cyan: '#7ed4e3',
    white: '#f3f2f2',
    brightBlack: '#9b9797',
    brightRed: '#ffc4b8',
    brightGreen: '#b8e8c8',
    brightYellow: '#f0d080',
    brightBlue: '#a8c4ff',
    brightMagenta: '#ddb8f0',
    brightCyan: '#a8e8f0',
    brightWhite: '#ffffff',
  };
}

export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light';
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/** Pull pastel RGB down so it stays readable on the light terminal ground. */
function inkRgb(r: number, g: number, b: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l <= 0.4) return [r, g, b];
  return hslToRgb(h, Math.min(1, s * 1.2), 0.34);
}

function index256ToRgb(n: number): [number, number, number] {
  if (n < 16) return [0, 0, 0];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return [v, v, v];
  }
  const i = n - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return [levels[Math.floor(i / 36)], levels[Math.floor((i % 36) / 6)], levels[i % 6]];
}

function rewriteSgrParams(raw: string): string {
  const params = raw.split(/[;:]/).filter(p => p !== '').map(p => Number(p));
  if (!params.length || params.some(n => !Number.isFinite(n))) return raw;
  const out: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if ((p === 38 || p === 48) && params[i + 1] === 2) {
      let r = params[i + 2] ?? 0;
      let g = params[i + 3] ?? 0;
      let b = params[i + 4] ?? 0;
      if (p === 38) [r, g, b] = inkRgb(r, g, b);
      out.push(p, 2, r, g, b);
      i += 4;
    } else if ((p === 38 || p === 48) && params[i + 1] === 5) {
      const idx = params[i + 2] ?? 0;
      if (p === 38 && idx >= 16) {
        const [r, g, b] = inkRgb(...index256ToRgb(idx));
        out.push(38, 2, r, g, b);
      } else {
        out.push(p, 5, idx);
      }
      i += 2;
    } else {
      out.push(p);
    }
  }
  return out.join(';');
}

/**
 * Claude Code paints hashes/paths with 256-color or truecolor pastels.
 * Those bypass xterm's 16-color theme, so rewrite them in light mode.
 */
export function adaptAnsiForLightTheme(data: string): string {
  if (!isLightTheme()) return data;
  return data.replace(/\x1b\[([0-9;:]*)m/g, (_all, body: string) => {
    if (!body) return '\x1b[m';
    return `\x1b[${rewriteSgrParams(body)}m`;
  });
}
