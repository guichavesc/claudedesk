import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** input + output + cache create (cache reads are discounted / not "spent" the same way) */
  totalTokens: number;
  requestCount: number;
  found: boolean;
}

const EMPTY: SessionTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  found: false,
};

/** Claude Code encodes workspace paths as a single slug under projects/. */
export function workspaceToProjectSlug(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}

function resolveTranscriptPath(configDir: string, workspacePath: string, sessionId: string): string | null {
  const expanded = configDir.replace(/^~(?=$|[/\\])/, os.homedir());
  const projectsRoot = path.join(expanded, 'projects');
  if (!fs.existsSync(projectsRoot)) return null;

  const direct = path.join(projectsRoot, workspaceToProjectSlug(workspacePath), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) return direct;

  // Fallback: search by session id if the slug encoding ever drifts.
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

/**
 * Sum token usage from a Claude Code session transcript.
 * Dedupes by requestId so streamed chunks of the same API call aren't counted twice.
 */
export function readSessionTokenUsage(
  configDir: string | null | undefined,
  workspacePath: string,
  sessionId: string,
): SessionTokenUsage {
  if (!configDir || !workspacePath || !sessionId) return { ...EMPTY };

  const filePath = resolveTranscriptPath(configDir, workspacePath, sessionId);
  if (!filePath) return { ...EMPTY };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { ...EMPTY };
  }

  const seen = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let requestCount = 0;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (row.type !== 'assistant') continue;
    const usage = row.message?.usage;
    if (!usage) continue;

    // Prefer requestId; fall back to message id so we still dedupe when requestId is missing.
    const key = row.requestId || row.message?.id;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }

    inputTokens += Number(usage.input_tokens) || 0;
    outputTokens += Number(usage.output_tokens) || 0;
    cacheReadTokens += Number(usage.cache_read_input_tokens) || 0;
    cacheCreateTokens += Number(usage.cache_creation_input_tokens) || 0;
    requestCount += 1;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreateTokens,
    totalTokens: inputTokens + outputTokens + cacheCreateTokens,
    requestCount,
    found: requestCount > 0,
  };
}
