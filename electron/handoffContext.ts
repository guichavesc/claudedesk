import fs from 'fs';
import os from 'os';
import path from 'path';
import { workspaceToProjectSlug } from './sessionUsage.js';

const MAX_HANDOFF_CHARS = 90_000;

function expandHome(p: string): string {
  return p.replace(/^~(?=$|[/\\])/, os.homedir());
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function resolveClaudeTranscript(configDir: string, workspacePath: string, sessionId: string): string | null {
  const expanded = expandHome(configDir);
  const projectsRoot = path.join(expanded, 'projects');
  if (!fs.existsSync(projectsRoot)) return null;

  const direct = path.join(projectsRoot, workspaceToProjectSlug(workspacePath), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) return direct;

  try {
    for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsRoot, entry.name, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return null;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as any).text || '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Build a plain-text handoff prompt from Claude JSONL (preferred) or terminal snapshot. */
export function buildHandoffContext(opts: {
  provider: string;
  configDir?: string | null;
  workspacePath: string;
  sessionId: string;
  terminalBuffer?: string | null;
  sourceLabel?: string;
}): string {
  const preamble =
    `You are continuing a coding session that was transferred from ${opts.sourceLabel || opts.provider}.\n` +
    `Workspace: ${opts.workspacePath}\n` +
    `Pick up where the prior assistant left off. Prior conversation context follows.\n\n` +
    `--- BEGIN PRIOR CONTEXT ---\n`;

  const footer = `\n--- END PRIOR CONTEXT ---\n\nPlease acknowledge briefly and continue the work.`;

  let body = '';

  if (opts.provider === 'claude' && opts.configDir) {
    const filePath = resolveClaudeTranscript(opts.configDir, opts.workspacePath, opts.sessionId);
    if (filePath) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const turns: string[] = [];
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          let row: any;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          if (row.type === 'user' && row.message) {
            const text = extractTextFromContent(row.message.content).trim();
            if (text) turns.push(`User:\n${text}`);
          } else if (row.type === 'assistant' && row.message) {
            const text = extractTextFromContent(row.message.content).trim();
            if (text) turns.push(`Assistant:\n${text}`);
          }
        }
        body = turns.join('\n\n');
      } catch {
        body = '';
      }
    }
  }

  if (!body && opts.terminalBuffer) {
    body = stripAnsi(opts.terminalBuffer).trim();
  }

  if (!body) {
    body = '(No prior transcript was available. Continue based on the workspace contents.)';
  }

  let full = preamble + body + footer;
  if (full.length > MAX_HANDOFF_CHARS) {
    const keep = MAX_HANDOFF_CHARS - preamble.length - footer.length - 80;
    body = `…[truncated earlier context]…\n` + body.slice(-Math.max(keep, 1000));
    full = preamble + body + footer;
  }

  return full;
}
