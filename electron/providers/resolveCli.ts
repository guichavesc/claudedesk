import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getLoginShellPath } from '../claudeCli.js';

export interface CliLaunch {
  /** Executable to spawn (gemini, codex, or npx). */
  command: string;
  /** Args inserted before provider flags (e.g. ['-y', '@google/gemini-cli']). */
  argsPrefix: string[];
  /** True when falling back to npx instead of a global install. */
  viaNpx: boolean;
}

function which(bin: string): string | null {
  const pathEnv = getLoginShellPath();
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execSync(`${whichCmd} ${bin}`, {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PATH: pathEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)[0];
    if (result && fs.existsSync(result)) return result;
  } catch {
    // ignore
  }
  return null;
}

function candidatePaths(bin: string): string[] {
  const home = os.homedir();
  const name = process.platform === 'win32' ? `${bin}.cmd` : bin;
  return [
    path.join(home, '.npm-global', 'bin', name),
    path.join(home, '.local', 'bin', name),
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
  ];
}

function findOnDisk(bin: string): string | null {
  const fromPath = which(bin);
  if (fromPath) return fromPath;
  for (const c of candidatePaths(bin)) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // next
    }
  }
  return null;
}

/**
 * Prefer a globally installed CLI; otherwise fall back to `npx -y <npmPackage>`.
 * Requires either the binary or `npx`/`npm` on PATH.
 */
export function resolveCliLaunch(bin: string, npmPackage: string): CliLaunch {
  const direct = findOnDisk(bin);
  if (direct) {
    return { command: direct, argsPrefix: [], viaNpx: false };
  }

  const npx = findOnDisk('npx');
  if (npx) {
    return {
      command: npx,
      // -y skips the install prompt so the PTY doesn't hang waiting for input.
      argsPrefix: ['-y', npmPackage],
      viaNpx: true,
    };
  }

  throw new Error(
    `${bin} CLI not found, and npx is unavailable. Install Node.js/npm, or install the CLI:\n` +
      `  npm install -g ${npmPackage}\n` +
      `  # or run once via: npx -y ${npmPackage}`,
  );
}
