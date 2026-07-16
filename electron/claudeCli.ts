import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const PACKAGE_PREFIX = '@anthropic-ai/claude-code';
const BINARY_NAME = 'claude';

const PLATFORMS: Record<string, { pkg: string; bin: string }> = {
  'darwin-arm64': { pkg: `${PACKAGE_PREFIX}-darwin-arm64`, bin: BINARY_NAME },
  'darwin-x64': { pkg: `${PACKAGE_PREFIX}-darwin-x64`, bin: BINARY_NAME },
  'linux-x64': { pkg: `${PACKAGE_PREFIX}-linux-x64`, bin: BINARY_NAME },
  'linux-arm64': { pkg: `${PACKAGE_PREFIX}-linux-arm64`, bin: BINARY_NAME },
  'linux-x64-musl': { pkg: `${PACKAGE_PREFIX}-linux-x64-musl`, bin: BINARY_NAME },
  'linux-arm64-musl': { pkg: `${PACKAGE_PREFIX}-linux-arm64-musl`, bin: BINARY_NAME },
  'win32-x64': { pkg: `${PACKAGE_PREFIX}-win32-x64`, bin: `${BINARY_NAME}.exe` },
  'win32-arm64': { pkg: `${PACKAGE_PREFIX}-win32-arm64`, bin: `${BINARY_NAME}.exe` },
};

function detectMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report =
    typeof process.report?.getReport === 'function'
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
      : null;
  return report != null && report.header?.glibcVersionRuntime === undefined;
}

function getPlatformKey(): string {
  const platform = process.platform;
  let cpu = os.arch();
  if (platform === 'linux') {
    return `linux-${cpu}${detectMusl() ? '-musl' : ''}`;
  }
  // Rosetta 2: x64 Node on Apple Silicon — prefer native arm64 binary.
  if (platform === 'darwin' && cpu === 'x64') {
    const r = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], { encoding: 'utf8' });
    if (r.stdout?.trim() === '1') cpu = 'arm64';
  }
  return `${platform}-${cpu}`;
}

/**
 * Electron's require.resolve returns paths inside app.asar. Native binaries must be
 * executed from app.asar.unpacked — the OS cannot execve a file stored in the archive
 * even though Electron's virtual FS makes existsSync return true.
 */
function toRealBinaryPath(candidate: string): string | null {
  const unpacked = candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  for (const p of [unpacked, candidate]) {
    try {
      // realpathSync fails for asar-virtual paths that aren't actually on disk
      const real = fs.realpathSync(p);
      fs.accessSync(real, fs.constants.X_OK);
      return real;
    } catch {
      // try next
    }
  }
  return null;
}

function candidateRoots(): string[] {
  const roots: string[] = [];
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
    roots.push(path.join(process.resourcesPath, 'app'));
  }
  roots.push(path.join(__dirname, '..'));
  roots.push(process.cwd());
  return roots;
}

let cachedBinaryPath: string | null = null;

/** Native Claude Code binary shipped with the app (not `npx`, which GUI apps can't find). */
export function resolveClaudeBinary(): string {
  if (cachedBinaryPath) {
    try {
      fs.accessSync(cachedBinaryPath, fs.constants.X_OK);
      return cachedBinaryPath;
    } catch {
      cachedBinaryPath = null;
    }
  }

  const platformKey = getPlatformKey();
  const info = PLATFORMS[platformKey];
  if (!info) {
    throw new Error(`Unsupported platform for Claude Code: ${process.platform} ${os.arch()}`);
  }

  const candidates: string[] = [];

  // Prefer the unpacked tree first — that's the only place spawn() can actually exec.
  for (const root of candidateRoots()) {
    candidates.push(path.join(root, 'node_modules', info.pkg, info.bin));
  }

  const req = eval('require') as NodeRequire;
  try {
    const pkgDir = path.dirname(req.resolve(`${info.pkg}/package.json`));
    candidates.push(path.join(pkgDir, info.bin));
  } catch {
    // ignore — filesystem candidates above are enough in the packaged app
  }

  for (const candidate of candidates) {
    const real = toRealBinaryPath(candidate);
    if (real) {
      cachedBinaryPath = real;
      return real;
    }
  }

  throw new Error(`Claude CLI binary not found for ${platformKey}`);
}

let cachedLoginPath: string | null = null;

function defaultPath(): string {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    process.env.PATH || '',
  ]
    .filter(Boolean)
    .join(':');
}

/**
 * GUI-launched apps get a minimal PATH. Load the user's login-shell PATH once.
 * IMPORTANT: use non-interactive `-lc` (never `-ilc`). An interactive shell started
 * from an Electron process that was itself launched from Terminal can steal/disrupt
 * the controlling TTY and cause node-pty to fail with EIO on write.
 */
export function getLoginShellPath(): string {
  if (cachedLoginPath) return cachedLoginPath;

  if (process.platform === 'win32') {
    cachedLoginPath = process.env.PATH || '';
    return cachedLoginPath;
  }

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = execSync(`${shell} -lc 'printf %s "$PATH"'`, {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        // Prevent oh-my-zsh / powerlevel10k from treating this as an interactive session
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cachedLoginPath = result || defaultPath();
    return cachedLoginPath;
  } catch {
    cachedLoginPath = defaultPath();
    return cachedLoginPath;
  }
}

export function augmentShellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = os.homedir();
  return {
    ...env,
    HOME: env.HOME || home,
    USER: env.USER || os.userInfo().username,
    TMPDIR: env.TMPDIR || os.tmpdir(),
    TERM: env.TERM || 'xterm-256color',
    COLORTERM: env.COLORTERM || 'truecolor',
    LANG: env.LANG || 'en_US.UTF-8',
    PATH: getLoginShellPath(),
    CLAUDE_CODE_INSTALLED_VIA_NPM_WRAPPER: '1',
    // Avoid inheriting Electron's Electron-specific vars into the Claude child
    ELECTRON_RUN_AS_NODE: undefined,
    ELECTRON_NO_ATTACH_CONSOLE: undefined,
  };
}
