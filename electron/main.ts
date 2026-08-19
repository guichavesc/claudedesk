import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';

// Set globals for bundled native modules (like bindings)
Object.assign(global, { __filename: __filename, __dirname: __dirname });

import { initDb, getDb } from './db.js';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import * as profileConfig from './profileConfig.js';
import { augmentShellEnv, resolveClaudeBinary } from './claudeCli.js';
import { readSessionTokenUsage } from './sessionUsage.js';
import { getProvider, getProviderForProfile, isProviderBound, normalizeProvider, checkProviderCli, type ResumeMode } from './providers/index.js';
import { buildHandoffContext } from './handoffContext.js';

// Pin the product name + userData folder before app ready. Renaming package.json
// previously moved Electron's data dir (agent-app -> ClaudeDesk) and looked like
// "lost" profiles/sessions — keep this stable from now on.
app.setName('ClaudeDesk');
app.setPath('userData', path.join(app.getPath('appData'), 'ClaudeDesk'));

const execFileAsync = promisify(execFile);

interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  message: string;
}

// All git IPC goes through this helper: argv-only (no shell), stderr captured (never
// inherited onto the Electron process — that was flooding logs and could surface as
// uncaught noise), no interactive credential prompts (fail fast instead of hanging
// the main process), and a hard timeout so a stuck network never freezes the app.
async function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<GitRunResult> {
  if (!cwd || typeof cwd !== 'string') {
    return { ok: false, stdout: '', stderr: '', message: 'Invalid workspace path' };
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      // Prevent git from blocking the main process waiting on a TTY/askpass dialog.
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GC_TRACE: undefined,
      },
    });
    const out = (stdout || '').toString();
    const err = (stderr || '').toString();
    return {
      ok: true,
      stdout: out,
      stderr: err,
      message: (out.trim() || err.trim() || 'OK'),
    };
  } catch (e: any) {
    // timed out, non-zero exit, missing git binary, bad cwd — never throw to IPC
    const killed = e?.killed || e?.signal === 'SIGTERM';
    const stdout = (e?.stdout ?? '').toString();
    const stderr = (e?.stderr ?? '').toString();
    const fallback = e?.message ? String(e.message) : 'Git command failed';
    const detail = (stderr.trim() || stdout.trim() || fallback).trim();
    return {
      ok: false,
      stdout,
      stderr,
      message: killed ? `Git timed out after ${Math.round(timeoutMs / 1000)}s — ${detail}` : detail,
    };
  }
}

function firstLine(text: string): string {
  return text.split('\n').map(l => l.trim()).find(Boolean) || text.trim();
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// PTY events are emitted asynchronously by the OS and can still land after the window
// (and its webContents) started tearing down during quit. Rather than let a stray one
// crash the whole app with an "Uncaught Exception" dialog, swallow destroyed-object
// errors once we're already shutting down — anything else still gets logged.
process.on('uncaughtException', (err) => {
  if (isQuitting && /Object has been destroyed/i.test(err?.message || '')) {
    console.warn('[Shutdown] Ignored post-quit error:', err.message);
    return;
  }
  console.error('[Uncaught Exception]', err);
});

// PTY output/exit events are async and can still fire after the window has started
// tearing down during app quit — `mainWindow` may be non-null but its native
// webContents object already destroyed, which throws "Object has been destroyed"
// if sent to directly. Route all renderer pushes through this guard instead.
function safeSend(channel: string, ...args: any[]) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (e) {
    // Window was destroyed between the checks above and the send call — safe to ignore.
  }
}

interface ActiveCliSession {
  pty: any;
  session: any;
  buffer: string;
  saveTimer: NodeJS.Timeout;
  pendingInitialPrompt?: string;
  limitNotified?: boolean;
  providerId?: string;
}

// Each entry holds the live PTY process, the session row used to spawn it, and an
// in-memory transcript buffer. The buffer keeps accumulating even while a session's
// tab isn't focused, so switching back to it (or the app restarting) never loses output.
const activeCliSessions: Record<string, ActiveCliSession> = {};
const MAX_BUFFER_CHARS = 500_000;

function persistBuffer(sessionId: string) {
  const active = activeCliSessions[sessionId];
  if (!active) return;
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO terminal_snapshots (session_id, buffer, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET buffer = excluded.buffer, updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, active.buffer);
  } catch (e) {
    console.error('[PTY] Failed to persist buffer for', sessionId, e);
  }

  // Once there's enough conversation, generate a short descriptive title once
  // (Claude Code Desktop style) so tabs/sidebar aren't just folder names.
  void maybeGenerateSessionTitle(sessionId);
}

const TITLE_MIN_TRANSCRIPT_CHARS = 400;
const titleGenerationInFlight = new Set<string>();
const titleNextAttemptAt = new Map<string, number>();

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

async function maybeGenerateSessionTitle(sessionId: string) {
  if (titleGenerationInFlight.has(sessionId)) return;
  if ((titleNextAttemptAt.get(sessionId) || 0) > Date.now()) return;

  const db = getDb();
  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session || session.title) return;

  const active = activeCliSessions[sessionId];
  const buffer = active?.buffer
    || (db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sessionId) as any)?.buffer
    || '';
  const plain = stripAnsi(buffer).trim();
  if (plain.length < TITLE_MIN_TRANSCRIPT_CHARS) return;

  const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(session.profile_id);
  if (!profile) return;

  titleGenerationInFlight.add(sessionId);
  try {
    const prompt = [
      'Write a very short session title (3-7 words) summarizing what this Claude Code conversation is about.',
      'Match the style of titles like "TDD analysis for experiments-api" or "Database to Snowflake data flow".',
      'Output ONLY the title — no quotes, no trailing punctuation, no explanation.',
      '',
      'Transcript:',
      plain.slice(-8000),
    ].join('\n');

    const raw = await runClaudePrint(prompt, session.model, session.workspace_path, buildClaudeEnv(profile));
    const cleaned = raw
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0)
      ?.replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[.!?]+$/g, '')
      .trim()
      .slice(0, 80);

    if (!cleaned) {
      titleNextAttemptAt.set(sessionId, Date.now() + 120_000);
      return;
    }

    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(cleaned, sessionId);
    console.log('[Title] Generated for', sessionId, '→', cleaned);
    safeSend('session-title-updated', sessionId, cleaned);
  } catch (e) {
    console.error('[Title] Failed to generate for', sessionId, e);
    titleNextAttemptAt.set(sessionId, Date.now() + 120_000);
  } finally {
    titleGenerationInFlight.delete(sessionId);
  }
}

let ptyModule: any = null;
function getPty() {
  if (!ptyModule) {
    // node-pty is a native addon; load it via indirect require so the bundler doesn't touch it
    const req = eval('require');
    ptyModule = req('node-pty');
  }
  return ptyModule;
}

function decryptProfileApiKey(encrypted: string): string | null {
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function buildProviderEnv(profile: any): NodeJS.ProcessEnv {
  return getProviderForProfile(profile).buildEnv(profile, decryptProfileApiKey);
}

/** Claude-only helpers (plugins/MCP) still use the Claude adapter env. */
function buildClaudeEnv(profile: any): NodeJS.ProcessEnv {
  return getProvider('claude').buildEnv(profile, decryptProfileApiKey);
}

// Runs Claude Code once in non-interactive (-p) mode with no tool access, piping the
// prompt over stdin (transcripts can be large, so an argv-based prompt risks ARG_MAX).
// Used for generating session summaries.
function runClaudePrint(prompt: string, model: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveClaudeBinary(), ['-p', '--model', model, '--tools', '', '--no-session-persistence'], {
      cwd,
      env: augmentShellEnv(env),
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out waiting for Claude to generate the summary'));
    }, 90_000);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || 'Claude CLI exited without producing a summary'));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Spawns (or re-spawns) the interactive provider CLI PTY for a session.
function spawnProviderPty(
  sessionId: string,
  cols = 80,
  rows = 30,
  opts?: { initialPrompt?: string },
): { success: boolean; message?: string } {
  const db = getDb();
  const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) {
    return { success: false, message: 'Session not found' };
  }

  const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(session.profile_id);
  if (!profile) {
    return { success: false, message: 'Profile not found' };
  }

  const provider = getProviderForProfile(profile);
  const providerId = normalizeProvider(session.provider || profile.provider);

  const snapshotRow: any = db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sessionId);
  const priorBuffer: string = snapshotRow?.buffer || '';
  const hasPriorTranscript = priorBuffer.length > 0;
  const canResumeById = isProviderBound(session);

  let resumeMode: ResumeMode = 'new';
  if (hasPriorTranscript && canResumeById) resumeMode = 'resume';
  else if (hasPriorTranscript && !canResumeById) resumeMode = 'continue';

  const env = buildProviderEnv(profile);
  const providerArgs = provider.buildSpawnArgs({
    session: {
      id: session.id,
      model: session.model,
      permission_mode: session.permission_mode,
      provider_session_id: session.provider_session_id,
    },
    resumeMode,
  });

  const pty = getPty();
  let command: string;
  let args: string[];
  try {
    const launch = provider.resolveLaunch();
    command = launch.command;
    args = [...launch.argsPrefix, ...providerArgs];
    if (launch.viaNpx) {
      console.log(`[PTY] ${provider.displayName} not on PATH — using npx fallback`);
    }
  } catch (e: any) {
    console.error(`[PTY] Failed to resolve ${provider.displayName} binary:`, e);
    return { success: false, message: e?.message || `${provider.displayName} CLI not found` };
  }

  console.log(
    `[PTY] Spawning ${provider.id} for session`,
    sessionId,
    '| binary:',
    command,
    '| args:',
    args,
    '| cwd:',
    session.workspace_path,
  );

  const ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: session.workspace_path,
    env,
  });

  ptyProcess.onData((data: string) => {
    const active = activeCliSessions[sessionId];
    if (active) {
      active.buffer += data;
      if (active.buffer.length > MAX_BUFFER_CHARS) {
        active.buffer = active.buffer.slice(active.buffer.length - MAX_BUFFER_CHARS);
      }

      // Inject transfer handoff once the CLI has started printing (banner/prompt).
      if (active.pendingInitialPrompt && active.buffer.length > 80) {
        const prompt = active.pendingInitialPrompt;
        active.pendingInitialPrompt = undefined;
        setTimeout(() => {
          try {
            active.pty?.write(prompt.endsWith('\n') ? prompt : `${prompt}\n`);
          } catch (e) {
            console.error('[PTY] Failed to write handoff prompt', e);
          }
        }, 600);
      }

      if (!active.limitNotified) {
        const adapter = getProvider(active.providerId || providerId);
        if (adapter.rateLimitPatterns.some((re) => re.test(data))) {
          active.limitNotified = true;
          safeSend('session-limit-detected', sessionId);
        }
      }
    }
    safeSend('pty-output', sessionId, data);
  });

  const spawnedAt = Date.now();
  ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    console.log('[PTY] Session', sessionId, 'process exited with code', exitCode, 'signal', signal);
    if (Date.now() - spawnedAt < 4000) {
      const reason = signal ? `killed by signal ${signal}` : `exit code ${exitCode}`;
      const active = activeCliSessions[sessionId];
      const tail = (active?.buffer || '').split('\n').slice(-6).join('\n').trim();
      const note =
        `\r\n\x1b[31m--- ${provider.displayName} process exited almost immediately (${reason}) ---\x1b[0m\r\n` +
        (tail ? `\x1b[2m${tail}\x1b[0m\r\n` : '\x1b[2m(no output was produced before it exited)\x1b[0m\r\n');
      safeSend('pty-output', sessionId, note);
      if (active) active.buffer += note;
    }
    persistBuffer(sessionId);
    if (activeCliSessions[sessionId]) {
      clearInterval(activeCliSessions[sessionId].saveTimer);
    }
    delete activeCliSessions[sessionId];
    safeSend('pty-exit', sessionId, exitCode);
  });

  const saveTimer = setInterval(() => persistBuffer(sessionId), 3000);

  activeCliSessions[sessionId] = {
    pty: ptyProcess,
    session,
    buffer: priorBuffer,
    saveTimer,
    pendingInitialPrompt: opts?.initialPrompt,
    providerId,
  };

  // Claude: mark bound when we passed --session-id on a fresh spawn.
  // Gemini/Codex: mark bound on first successful fresh spawn so reopen can resume.
  if (resumeMode === 'new' && !isProviderBound(session)) {
    try {
      db.prepare(`
        UPDATE sessions
        SET provider_bound = 1, claude_bound = CASE WHEN ? = 'claude' THEN 1 ELSE claude_bound END,
            provider_session_id = COALESCE(provider_session_id, ?)
        WHERE id = ?
      `).run(providerId, session.id, sessionId);
      session.provider_bound = 1;
      if (providerId === 'claude') session.claude_bound = 1;
      if (!session.provider_session_id) session.provider_session_id = session.id;
    } catch (e) {
      console.error('[PTY] Failed to mark session as provider_bound', sessionId, e);
    }
  }

  return { success: true };
}

/** @deprecated Use spawnProviderPty */
function spawnClaudePty(sessionId: string, cols = 80, rows = 30) {
  return spawnProviderPty(sessionId, cols, rows);
}

function killClaudePty(sessionId: string) {
  const active = activeCliSessions[sessionId];
  if (active) {
    clearInterval(active.saveTimer);
    persistBuffer(sessionId);
    if (active.pty) {
      try {
        active.pty.kill();
      } catch (e) {
        console.error('[PTY] Error killing process for session', sessionId, e);
      }
    }
    delete activeCliSessions[sessionId];
  }
}

function resolveAppIcon(): string {
  // Runtime dock/window icons need a format NativeImage can decode. Electron's
  // dock.setIcon() often fails on .icns in unpackaged/dev builds, so prefer PNG
  // here and leave .icns for electron-builder packaging only.
  const roots = [
    path.join(__dirname, '..'),
    process.resourcesPath || '',
    path.join(process.resourcesPath || '', 'app.asar.unpacked'),
  ].filter(Boolean);

  const names = ['icon-512.png', 'icon.png', 'icon-dock.png'];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, 'build', name);
      if (fs.existsSync(candidate)) return candidate;
      // Packaged: icons may live directly under Resources via extraResources
      const alt = path.join(root, name);
      if (fs.existsSync(alt)) return alt;
    }
  }
  return '';
}

function createWindow() {
  const icon = resolveAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hiddenInset',
    title: 'ClaudeDesk',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Keep the OS window title in sync even though we use a custom title bar.
  mainWindow.setTitle('ClaudeDesk');

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      const icon = resolveAppIcon();
      if (icon) app.dock.setIcon(icon);
    } catch (e) {
      console.warn('[App] Could not set dock icon:', e);
    }
  }

  initDb();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  isQuitting = true;
  for (const sessionId of Object.keys(activeCliSessions)) {
    killClaudePty(sessionId);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  for (const sessionId of Object.keys(activeCliSessions)) {
    killClaudePty(sessionId);
  }
});

function setupIpcHandlers() {
  ipcMain.handle('getProfiles', () => {
    const db = getDb();
    return db.prepare('SELECT id, name, auth_type, provider, created_at FROM profiles').all();
  });

  ipcMain.handle('createProfile', (_event, profileData) => {
    const db = getDb();
    const id = randomUUID();
    let encryptedKey = null;
    const provider = normalizeProvider(profileData.provider);
    const adapter = getProvider(provider);

    // Block Gemini/Codex profiles when the CLI isn't installed locally.
    if (provider !== 'claude') {
      const cli = checkProviderCli(provider);
      if (!cli.available) {
        return {
          success: false,
          message: cli.message || `${adapter.displayName} CLI not found`,
          installHint: cli.installHint,
        };
      }
    }

    if (profileData.apiKey && safeStorage.isEncryptionAvailable()) {
      encryptedKey = safeStorage.encryptString(profileData.apiKey).toString('base64');
    }

    // Map UI auth labels: Claude subscription, Gemini google, Codex chatgpt → stored auth_type
    let authType = profileData.authType || 'apikey';
    if (provider === 'gemini' && authType === 'subscription') authType = 'google';
    if (provider === 'codex' && (authType === 'subscription' || authType === 'google')) authType = 'chatgpt';

    const configDir = adapter.defaultConfigDir(profileData.name);

    db.prepare(`
      INSERT INTO profiles (id, name, auth_type, keytar_service_key, claude_config_dir, provider)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, profileData.name, authType, encryptedKey, configDir, provider);

    return { success: true, id };
  });

  ipcMain.handle('checkProviderCli', (_event, provider) => {
    return checkProviderCli(provider);
  });

  ipcMain.handle('deleteProfile', (_event, profileId) => {
    console.log('[Delete Profile Backend] Starting deletion for profileId:', profileId);
    
    const db = getDb();
    const fs = require('fs');
    const os = require('os');
    const homedir = os.homedir();
    
    try {
      // Get profile info before deleting
      console.log('[Delete Profile Backend] Fetching profile from database...');
      const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      console.log('[Delete Profile Backend] Profile data:', profile);
      
      if (!profile) {
        console.error('[Delete Profile Backend] Profile not found in database');
        return { success: false, message: 'Profile not found' };
      }

      // Block while any sessions (active or archived) still reference this profile.
      console.log('[Delete Profile Backend] Checking for sessions...');
      const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE profile_id = ?').get(profileId) as any;
      console.log('[Delete Profile Backend] Sessions count:', sessionCount.count);
      
      if (sessionCount.count > 0) {
        console.error('[Delete Profile Backend] Profile has sessions, cannot delete');
        return { 
          success: false, 
          message: 'Cannot delete profile with sessions. Archive and permanently delete them first.' 
        };
      }

      // Delete the config directory if it exists
      if (profile.claude_config_dir) {
        const configDir = profile.claude_config_dir.replace('~', homedir);
        console.log('[Delete Profile Backend] Checking config directory:', configDir);
        
        if (fs.existsSync(configDir)) {
          console.log('[Delete Profile Backend] Config directory exists, removing...');
          fs.rmSync(configDir, { recursive: true, force: true });
          console.log('[Delete Profile Backend] Config directory removed successfully');
        } else {
          console.log('[Delete Profile Backend] Config directory does not exist, skipping');
        }
      } else {
        console.log('[Delete Profile Backend] No config directory specified');
      }

      // Delete from database
      console.log('[Delete Profile Backend] Deleting from database...');
      const deleteResult = db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
      console.log('[Delete Profile Backend] Database deletion result:', deleteResult);
      
      console.log('[Delete Profile Backend] Profile deleted successfully');
      return { success: true, message: 'Profile deleted successfully' };
      
    } catch (error: any) {
      console.error('[Delete Profile Backend] Exception occurred:', error);
      console.error('[Delete Profile Backend] Error stack:', error.stack);
      return { success: false, message: error.message || 'Failed to delete profile' };
    }
  });

  // Per-profile MCP servers — read/write directly since it's just local config
  // (no network/CLI round-trip needed), which also makes "edit" straightforward.
  ipcMain.handle('getProfileMcpServers', (_event, profileId) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { servers: [], error: 'Profile not found' };
    return { servers: profileConfig.listMcpServers(profile) };
  });

  ipcMain.handle('saveProfileMcpServer', (_event, profileId, name, config, previousName) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.saveMcpServer(profile, name, config, previousName);
  });

  ipcMain.handle('deleteProfileMcpServer', (_event, profileId, name) => {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.deleteMcpServer(profile, name);
  });

  // Per-profile plugins — marketplace/install operations shell out to the real
  // `claude plugin` CLI (scoped to the profile's CLAUDE_CONFIG_DIR) since they involve
  // git clones and network access that can't be safely reproduced by hand-editing files.
  ipcMain.handle('getProfilePluginMarketplaces', async (_event, profileId) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { marketplaces: [], error: 'Profile not found' };
    return profileConfig.listPluginMarketplaces(buildClaudeEnv(profile));
  });

  ipcMain.handle('addProfilePluginMarketplace', async (_event, profileId, source) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.addPluginMarketplace(buildClaudeEnv(profile), source);
  });

  ipcMain.handle('removeProfilePluginMarketplace', async (_event, profileId, name) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.removePluginMarketplace(buildClaudeEnv(profile), name);
  });

  ipcMain.handle('getProfilePlugins', async (_event, profileId) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { plugins: [], error: 'Profile not found' };
    return profileConfig.listPlugins(buildClaudeEnv(profile));
  });

  ipcMain.handle('getProfileAvailablePlugins', (_event, profileId, installedIds = []) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { plugins: [], error: 'Profile not found' };
    return profileConfig.listAvailableMarketplacePlugins(profile, installedIds);
  });

  ipcMain.handle('installProfilePlugin', async (_event, profileId, spec) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.installPlugin(buildClaudeEnv(profile), spec);
  });

  ipcMain.handle('uninstallProfilePlugin', async (_event, profileId, spec) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.uninstallPlugin(buildClaudeEnv(profile), spec);
  });

  ipcMain.handle('setProfilePluginEnabled', (_event, profileId, spec, enabled) => {
    const db = getDb();
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) return { success: false, message: 'Profile not found' };
    return profileConfig.setPluginEnabled(profile, spec, enabled);
  });

  ipcMain.handle('getSessions', () => {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM sessions
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
               COALESCE(sort_order, 0) ASC,
               started_at DESC
    `).all();
  });

  ipcMain.handle('getProjects', () => {
    const db = getDb();
    return db.prepare(`SELECT * FROM projects ORDER BY COALESCE(sort_order, 0) ASC, name COLLATE NOCASE ASC`).all();
  });

  ipcMain.handle('createProject', (_event, name) => {
    const db = getDb();
    try {
      const cleaned = typeof name === 'string' ? name.trim().slice(0, 80) : '';
      if (!cleaned) return { success: false, message: 'Project name is required' };
      const id = randomUUID();
      const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM projects').get();
      db.prepare(`INSERT INTO projects (id, name, sort_order) VALUES (?, ?, ?)`).run(id, cleaned, (maxOrder?.m ?? -1) + 1);
      return { success: true, id };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('renameProject', (_event, projectId, name) => {
    const db = getDb();
    try {
      const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) return { success: false, message: 'Project not found' };
      const cleaned = typeof name === 'string' ? name.trim().slice(0, 80) : '';
      if (!cleaned) return { success: false, message: 'Project name is required' };
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(cleaned, projectId);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('deleteProject', (_event, projectId) => {
    const db = getDb();
    try {
      const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) return { success: false, message: 'Project not found' };
      db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('updateSessionProject', (_event, sessionId, projectId) => {
    const db = getDb();
    try {
      const session: any = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return { success: false, message: 'Session not found' };
      if (projectId) {
        const project: any = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
        if (!project) return { success: false, message: 'Project not found' };
      }
      db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?').run(projectId || null, sessionId);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('getRunningSessionIds', () => Object.keys(activeCliSessions));

  // Soft-close: keep history/snapshots so the session can be reopened later.
  ipcMain.handle('archiveSession', (_event, sessionId) => {
    const db = getDb();
    try {
      const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return { success: false, message: 'Session not found' };
      if (session.status === 'archived') return { success: true };

      killClaudePty(sessionId);
      db.prepare(`UPDATE sessions SET status = 'archived' WHERE id = ?`).run(sessionId);
      return { success: true };
    } catch (error: any) {
      console.error('[Archive Session] Error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('unarchiveSession', (_event, sessionId) => {
    const db = getDb();
    try {
      const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return { success: false, message: 'Session not found' };
      if (session.status === 'active') return { success: true };

      // Park reopened sessions at the end of the tab strip.
      const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM sessions').get();
      db.prepare(`UPDATE sessions SET status = 'active', sort_order = ? WHERE id = ?`)
        .run((maxOrder?.m ?? -1) + 1, sessionId);
      return { success: true };
    } catch (error: any) {
      console.error('[Unarchive Session] Error:', error);
      return { success: false, message: error.message };
    }
  });

  // Surfaces the last few distinct folders worked in, so starting a new session
  // in a familiar workspace doesn't require re-browsing the filesystem.
  ipcMain.handle('getRecentWorkspaces', () => {
    const db = getDb();
    const rows: any[] = db.prepare(`
      SELECT workspace_path, MAX(started_at) as last_used
      FROM sessions
      GROUP BY workspace_path
      ORDER BY last_used DESC
      LIMIT 5
    `).all();
    return rows.map(r => r.workspace_path);
  });

  ipcMain.handle('createSession', (_event, sessionData) => {
    const db = getDb();
    const id = randomUUID();
    // Prefer a palette color that isn't already heavily used across open sessions.
    const palette = ['#D4A843', '#4CAF7D', '#5B8DEF', '#B583D8', '#5BC6D8', '#E05C5C', '#E08A4D', '#3DB8A0'];
    const existing: any[] = db.prepare('SELECT color FROM sessions').all();
    const counts = new Map<string, number>(palette.map(c => [c, 0]));
    for (const row of existing) {
      if (row.color && counts.has(row.color)) counts.set(row.color, (counts.get(row.color) || 0) + 1);
    }
    let color = palette[0];
    let best = Infinity;
    for (const c of palette) {
      const n = counts.get(c) || 0;
      if (n < best) { color = c; best = n; }
    }

    const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM sessions').get();
    const sortOrder = (maxOrder?.m ?? -1) + 1;

    const profile: any = db.prepare('SELECT provider FROM profiles WHERE id = ?').get(sessionData.profileId);
    const provider = normalizeProvider(profile?.provider);

    db.prepare(`
      INSERT INTO sessions (id, profile_id, workspace_path, model, permission_mode, status, color, sort_order, provider, parent_session_id, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionData.profileId,
      sessionData.workspacePath,
      sessionData.model,
      sessionData.permissionMode || 'default',
      'active',
      color,
      sortOrder,
      provider,
      sessionData.parentSessionId || null,
      sessionData.projectId || null,
    );
    return id;
  });

  ipcMain.handle('updateSessionTitle', (_event, sessionId, title) => {
    const db = getDb();
    try {
      const session: any = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      if (!session) return { success: false, message: 'Session not found' };

      const cleaned = typeof title === 'string' ? title.trim().slice(0, 120) : '';
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(cleaned || null, sessionId);
      safeSend('session-title-updated', sessionId, cleaned || '');
      return { success: true, title: cleaned || null };
    } catch (error: any) {
      console.error('[Update Session Title] Error:', error);
      return { success: false, message: error.message };
    }
  });

  // Persist tab order after drag-and-drop. Expects the full ordered list of active session ids.
  ipcMain.handle('reorderSessions', (_event, orderedIds) => {
    const db = getDb();
    try {
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
        return { success: false, message: 'Invalid session order' };
      }

      const update = db.prepare('UPDATE sessions SET sort_order = ? WHERE id = ?');
      const tx = db.transaction((ids: string[]) => {
        ids.forEach((id, index) => update.run(index, id));
      });
      tx(orderedIds);
      return { success: true };
    } catch (error: any) {
      console.error('[Reorder Sessions] Error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('updateSessionMode', (_event, sessionId, permissionMode) => {
    const db = getDb();
    try {
      db.prepare('UPDATE sessions SET permission_mode = ? WHERE id = ?').run(permissionMode, sessionId);
      return { success: true };
    } catch (error: any) {
      console.error('[Update Session Mode] Error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('updateSessionColor', (_event, sessionId, color) => {
    const db = getDb();
    try {
      if (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return { success: false, message: 'Invalid color' };
      }
      db.prepare('UPDATE sessions SET color = ? WHERE id = ?').run(color, sessionId);
      return { success: true };
    } catch (error: any) {
      console.error('[Update Session Color] Error:', error);
      return { success: false, message: error.message };
    }
  });

  // Changing permission mode requires restarting the underlying Claude process,
  // since the flag is only read at spawn time.
  ipcMain.handle('restartCliSession', (_event, sessionId, cols, rows) => {
    killClaudePty(sessionId);
    return spawnProviderPty(sessionId, cols, rows);
  });

  ipcMain.handle('deleteSession', (_event, sessionId) => {
    console.log('[Delete Session] Starting deletion for sessionId:', sessionId);
    
    const db = getDb();
    
    try {
      // Get session info before deleting
      console.log('[Delete Session] Fetching session from database...');
      const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      console.log('[Delete Session] Session data:', session);
      
      if (!session) {
        console.error('[Delete Session] Session not found in database');
        return { success: false, message: 'Session not found' };
      }

      // Permanent delete is only allowed from the Archived view.
      if (session.status !== 'archived') {
        return { success: false, message: 'Archive the session before permanently deleting it.' };
      }

      // Clean up any active PTY process for this session
      console.log('[Delete Session] Cleaning up active PTY process');
      killClaudePty(sessionId);

      // Delete associated messages first (foreign key constraint)
      console.log('[Delete Session] Deleting associated messages...');
      const messagesResult = db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      console.log('[Delete Session] Deleted messages:', messagesResult.changes);

      // Delete terminal snapshot
      db.prepare('DELETE FROM terminal_snapshots WHERE session_id = ?').run(sessionId);

      // Delete the session
      console.log('[Delete Session] Deleting session from database...');
      const sessionResult = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      console.log('[Delete Session] Database deletion result:', sessionResult);
      
      console.log('[Delete Session] Session deleted successfully');
      return { success: true, message: 'Session closed successfully' };
      
    } catch (error: any) {
      console.error('[Delete Session] Exception occurred:', error);
      console.error('[Delete Session] Error stack:', error.stack);
      return { success: false, message: error.message || 'Failed to delete session' };
    }
  });

  ipcMain.handle('getMessages', (_event, sessionId) => {
    const db = getDb();
    return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
  });

  ipcMain.handle('saveMessage', (_event, message) => {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, message.session_id, message.role, message.content, message.timestamp);
    return id;
  });

  ipcMain.handle('startCliSession', (_event, sessionId, cols, rows) => {
    // If a PTY is already running for this session, just report it's ready.
    if (activeCliSessions[sessionId]?.pty) {
      return { success: true, alreadyRunning: true };
    }
    return spawnProviderPty(sessionId, cols, rows);
  });

  ipcMain.handle('sendCliInput', (_event, sessionId, data) => {
    const active = activeCliSessions[sessionId];
    if (!active?.pty) {
      return false;
    }
    try {
      active.pty.write(data);
      return true;
    } catch (e: any) {
      // EIO is expected once the child has exited — don't spam the console.
      if (e?.code !== 'EIO') {
        console.error('[PTY Input] Write failed for session', sessionId, e);
      }
      return false;
    }
  });

  ipcMain.handle('resizeCliSession', (_event, sessionId, cols, rows) => {
    const active = activeCliSessions[sessionId];
    if (active?.pty) {
      try {
        active.pty.resize(cols, rows);
      } catch (e) {
        console.error('[PTY Resize] Error:', e);
      }
    }
    return true;
  });

  ipcMain.handle('getTerminalSnapshot', (_event, sessionId) => {
    // Prefer the live in-memory buffer (always up to date, even if the tab was backgrounded)
    const active = activeCliSessions[sessionId];
    if (active) return active.buffer;

    // Fall back to the last buffer persisted to disk (e.g. after an app restart)
    const db = getDb();
    const row: any = db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sessionId);
    return row ? row.buffer : null;
  });

  ipcMain.handle('getSessionTokenUsage', (_event, sessionId) => {
    const db = getDb();
    const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0, requestCount: 0, found: false };
    }
    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(session.profile_id);
    return readSessionTokenUsage(profile?.claude_config_dir, session.workspace_path, sessionId);
  });

  ipcMain.handle('getGitDiff', async (_event, workspacePath) => {
    try {
      const diffRes = await runGit(['diff'], workspacePath, 30_000);
      if (!diffRes.ok && /not a git repository/i.test(diffRes.message)) {
        return { error: 'Not a git repository or git error' };
      }
      const statusRes = await runGit(['status', '-s'], workspacePath, 15_000);
      const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath, 10_000);
      return {
        diff: diffRes.ok ? diffRes.stdout : '',
        status: statusRes.ok ? statusRes.stdout : '',
        branch: branchRes.ok ? branchRes.stdout.trim() : '',
        ...(diffRes.ok ? {} : { error: firstLine(diffRes.message) || 'Git error' }),
      };
    } catch (e: any) {
      console.error('[getGitDiff]', e);
      return { error: e?.message || 'Not a git repository or git error' };
    }
  });

  ipcMain.handle('getGitBranches', async (_event, workspacePath) => {
    try {
      const listRes = await runGit(['branch', '--format=%(refname:short)'], workspacePath, 15_000);
      if (!listRes.ok) {
        return { branches: [], current: '', error: firstLine(listRes.message) || 'Not a git repository or git error' };
      }
      const branches = listRes.stdout.split('\n').map(b => b.trim()).filter(Boolean);
      const currentRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath, 10_000);
      return { branches, current: currentRes.ok ? currentRes.stdout.trim() : '' };
    } catch (e: any) {
      console.error('[getGitBranches]', e);
      return { branches: [], current: '', error: e?.message || 'Not a git repository or git error' };
    }
  });

  ipcMain.handle('checkoutGitBranch', async (_event, workspacePath, branchName) => {
    try {
      if (!branchName || typeof branchName !== 'string') {
        return { success: false, message: 'Branch name is required' };
      }
      const res = await runGit(['checkout', branchName], workspacePath, 30_000);
      return {
        success: res.ok,
        message: res.ok ? `Switched to "${branchName}"` : (firstLine(res.message) || 'Failed to switch branch'),
      };
    } catch (e: any) {
      console.error('[checkoutGitBranch]', e);
      return { success: false, message: e?.message || 'Failed to switch branch' };
    }
  });

  ipcMain.handle('createGitBranch', async (_event, workspacePath, branchName) => {
    try {
      if (!branchName || typeof branchName !== 'string') {
        return { success: false, message: 'Branch name is required' };
      }
      const res = await runGit(['checkout', '-b', branchName], workspacePath, 30_000);
      return {
        success: res.ok,
        message: res.ok ? `Created and switched to "${branchName}"` : (firstLine(res.message) || 'Failed to create branch'),
      };
    } catch (e: any) {
      console.error('[createGitBranch]', e);
      return { success: false, message: e?.message || 'Failed to create branch' };
    }
  });

  ipcMain.handle('gitCommit', async (_event, workspacePath, message, filePaths) => {
    try {
      if (!message || !String(message).trim()) {
        return { success: false, message: 'Commit message cannot be empty' };
      }
      const addArgs = Array.isArray(filePaths) && filePaths.length > 0
        ? ['add', '--', ...filePaths.map(String)]
        : ['add', '-A'];
      const addRes = await runGit(addArgs, workspacePath, 30_000);
      if (!addRes.ok) {
        return { success: false, message: firstLine(addRes.message) || 'Failed to stage files' };
      }
      const commitRes = await runGit(['commit', '-m', String(message)], workspacePath, 30_000);
      if (!commitRes.ok) {
        return { success: false, message: firstLine(commitRes.message) || 'Commit failed' };
      }
      return { success: true, message: firstLine(commitRes.stdout) || 'Committed successfully' };
    } catch (e: any) {
      console.error('[gitCommit]', e);
      return { success: false, message: e?.message || 'Commit failed' };
    }
  });

  // Push is especially failure-prone (auth, network, rejected non-ff). Always return
  // a structured result — never throw — and use a longer timeout for the network hop.
  ipcMain.handle('gitPush', async (_event, workspacePath) => {
    try {
      const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath, 10_000);
      const branch = branchRes.ok ? branchRes.stdout.trim() : '';

      const pushRes = await runGit(['push'], workspacePath, 120_000);
      if (pushRes.ok) {
        return { success: true, message: firstLine(pushRes.message) || 'Pushed successfully' };
      }

      // No upstream yet — set one on origin and retry once.
      const needsUpstream = branch && /set-upstream|no upstream|has no upstream branch/i.test(pushRes.message);
      if (needsUpstream) {
        const upstreamRes = await runGit(['push', '-u', 'origin', branch], workspacePath, 120_000);
        return {
          success: upstreamRes.ok,
          message: upstreamRes.ok
            ? (firstLine(upstreamRes.message) || `Pushed and set upstream to origin/${branch}`)
            : (firstLine(upstreamRes.message) || 'Push failed'),
        };
      }

      return { success: false, message: firstLine(pushRes.message) || 'Push failed' };
    } catch (e: any) {
      console.error('[gitPush]', e);
      return { success: false, message: e?.message || 'Push failed' };
    }
  });

  ipcMain.handle('exportSession', async (_event, sessionId) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    const db = getDb();
    
    const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return false;
    
    const snapshot: any = db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sessionId);
    // Strip ANSI escape codes so the exported transcript is plain, readable text
    const transcript = snapshot?.buffer ? snapshot.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') : '';

    const diffRes = await runGit(['diff'], session.workspace_path, 30_000);
    const diff = diffRes.ok ? diffRes.stdout : '';

    let md = `# ClaudeDesk Session Export\n\n`;
    md += `**Workspace:** \`${session.workspace_path}\`\n`;
    md += `**Model:** ${session.model}\n`;
    md += `**Started At:** ${session.started_at}\n\n`;
    md += `## Terminal Transcript\n\n`;
    md += transcript ? `\`\`\`\n${transcript}\n\`\`\`\n\n` : '_No transcript captured yet._\n\n';
    
    if (diff) {
      md += `## Git Diff\n\n\`\`\`diff\n${diff}\n\`\`\`\n`;
    }
    
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Session',
      defaultPath: `session_${sessionId.substring(0,8)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    
    if (!canceled && filePath) {
      fs.writeFileSync(filePath, md);
      return true;
    }
    return false;
  });

  ipcMain.handle('exportSessionSummary', async (_event, sessionId) => {
    const { dialog } = require('electron');
    const fs = require('fs');
    const db = getDb();

    const session: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { success: false, message: 'Session not found' };

    const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(session.profile_id);
    if (!profile) return { success: false, message: 'Profile not found' };

    const snapshot: any = db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sessionId);
    const rawTranscript = snapshot?.buffer ? snapshot.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') : '';
    // Cap the prompt size — summarizing the most recent activity is enough context
    // and keeps the one-shot call fast and cheap.
    const transcript = rawTranscript.length > 100_000 ? rawTranscript.slice(-100_000) : rawTranscript;

    if (!transcript.trim()) {
      return { success: false, message: 'Nothing to summarize yet — the session has no output.' };
    }

    const summaryDiffRes = await runGit(['diff'], session.workspace_path, 30_000);
    const diff = summaryDiffRes.ok ? summaryDiffRes.stdout : '';

    const prompt = [
      "You are summarizing a Claude Code terminal session for a developer's changelog.",
      'Below is the raw terminal transcript (ANSI codes already stripped) and the current git diff, if any.',
      'Write a concise Markdown summary (no headings level 1) with:',
      '- A short paragraph describing what was accomplished',
      '- A bullet list of key changes/decisions',
      '- A bullet list of any outstanding issues or follow-ups (omit this section if none)',
      'Do not quote raw logs or diffs verbatim, and do not include any preamble — output only the summary.',
      '',
      '## Transcript',
      transcript,
      diff ? `\n## Git Diff\n${diff}` : '',
    ].join('\n');

    try {
      const env = buildClaudeEnv(profile);
      const summary = await runClaudePrint(prompt, session.model, session.workspace_path, env);

      let md = `# Session Summary\n\n`;
      md += `**Workspace:** \`${session.workspace_path}\`\n`;
      md += `**Profile:** ${profile.name}\n`;
      md += `**Model:** ${session.model}\n`;
      md += `**Started At:** ${session.started_at}\n\n`;
      md += summary + '\n';

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export Session Summary',
        defaultPath: `session_summary_${sessionId.substring(0, 8)}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (!canceled && filePath) {
        fs.writeFileSync(filePath, md);
        return { success: true };
      }
      return { success: false, message: 'Export cancelled' };
    } catch (e: any) {
      console.error('[Export Summary] Error:', e);
      return { success: false, message: e.message || 'Failed to generate summary' };
    }
  });

  ipcMain.handle('openWorkspaceFolder', (_event, workspacePath) => {
    const { shell } = require('electron');
    shell.openPath(workspacePath);
    return true;
  });

  ipcMain.handle('getAppVersion', () => app.getVersion());

  ipcMain.handle('selectDirectory', async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Workspace Folder',
      properties: ['openDirectory']
    });
    
    if (!canceled && filePaths.length > 0) {
      return filePaths[0];
    }
    return null;
  });

  ipcMain.handle('startClaudeAuth', async (_event, profileName) => {
    const { shell } = require('electron');
    const os = require('os');
    const fs = require('fs');
    const homedir = os.homedir();
    
    return new Promise((resolve) => {
      try {
        // Create config directory for this profile
        const configDir = path.join(homedir, '.claude-profiles', profileName);
        console.log('[Auth] Creating config directory:', configDir);
        
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
          console.log('[Auth] Config directory created');
        }

        // Set environment to use this specific config directory
        const env = { 
          ...process.env,
          CLAUDE_CONFIG_DIR: configDir,
          FORCE_COLOR: '0',  // Disable colors for easier parsing
          CI: 'false'  // Prevent CI mode
        };

        console.log('[Auth] Starting Claude authentication...');
        
        // Run claude and capture output
        const child = spawn(resolveClaudeBinary(), [], {
          env: augmentShellEnv(env),
          cwd: homedir
        });

        let output = '';
        let authUrl = '';
        let urlOpened = false;

        // Timeout after 20 seconds if no URL found
        const timeout = setTimeout(() => {
          if (!urlOpened) {
            console.log('[Auth] Timeout - no auth URL detected');
            child.kill();
            resolve({
              success: false,
              message: 'Could not detect authentication URL. The Claude CLI may already be authenticated or needs manual setup.'
            });
          }
        }, 20000);

        child.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          console.log('[Auth] stdout:', text);

          // Look for any HTTPS URL
          const urls = text.match(/https:\/\/[^\s\)]+/gi);
          
          if (urls && !urlOpened) {
            for (const url of urls) {
              // Filter for authentication-related URLs
              if (url.includes('anthropic') || url.includes('console') || url.includes('auth') || url.includes('login')) {
                authUrl = url.replace(/[\)\]\}]+$/, ''); // Clean trailing punctuation
                console.log('[Auth] Found auth URL:', authUrl);
                
                shell.openExternal(authUrl).then(() => {
                  console.log('[Auth] Opened URL in browser');
                  urlOpened = true;
                  clearTimeout(timeout);
                  
                  // Show success message after URL is opened
                  setTimeout(() => {
                    resolve({
                      success: true,
                      message: 'Browser opened for authentication. Please complete login in your browser, then you can use this profile.'
                    });
                  }, 2000);
                }).catch((err: any) => {
                  console.error('[Auth] Failed to open URL:', err);
                });
                
                break;
              }
            }
          }

          // Check for success messages
          if (text.toLowerCase().includes('successfully') && text.toLowerCase().includes('authenticated')) {
            console.log('[Auth] Authentication success detected');
            clearTimeout(timeout);
            if (!urlOpened) {
              resolve({
                success: true,
                message: 'Authentication completed successfully!'
              });
            }
          }
        });

        child.stderr.on('data', (data) => {
          const text = data.toString();
          console.log('[Auth] stderr:', text);
          output += text;
        });

        child.on('error', (error) => {
          console.error('[Auth] Process error:', error);
          clearTimeout(timeout);
          resolve({
            success: false,
            message: `Failed to start Claude CLI: ${error.message}`
          });
        });

        child.on('close', (code) => {
          clearTimeout(timeout);
          console.log('[Auth] Process exited with code:', code);
          console.log('[Auth] Full output:', output);
          
          // Only resolve here if we haven't already resolved
          if (!urlOpened) {
            resolve({
              success: false,
              message: 'Claude CLI exited without showing authentication URL. It may already be authenticated.'
            });
          }
        });

      } catch (error: any) {
        console.error('[Auth] Exception:', error);
        resolve({
          success: false,
          message: error.message || 'Failed to start authentication'
        });
      }
    });
  });

  ipcMain.handle('getAvailableModels', async (_event, profileId) => {
    const db = getDb();
    const os = require('os');
    const fs = require('fs');
    const https = require('https');
    const homedir = os.homedir();
    
    try {
      const profile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      
      if (!profile) {
        return { models: [], error: 'Profile not found' };
      }

      const provider = getProviderForProfile(profile);
      if (provider.id !== 'claude') {
        return { models: provider.defaultModels() };
      }

      console.log('[Get Models] Fetching available models for profile:', profile.name);

      // Try to get models from Anthropic API
      return new Promise((resolve) => {
        let authHeader = '';
        
        // For API key profiles, use the API key
        if (profile.auth_type === 'apikey' && profile.keytar_service_key && safeStorage.isEncryptionAvailable()) {
          const decrypted = safeStorage.decryptString(Buffer.from(profile.keytar_service_key, 'base64'));
          authHeader = decrypted;
        } 
        // For subscription profiles, try to read auth from config
        else if (profile.auth_type === 'subscription' && profile.claude_config_dir) {
          const configDir = profile.claude_config_dir.replace('~', homedir);
          const claudeJsonPath = path.join(configDir, '.claude.json');
          
          if (fs.existsSync(claudeJsonPath)) {
            try {
              const config = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
              // Extract auth token from config
              if (config.auth && config.auth.token) {
                authHeader = config.auth.token;
              } else if (config.token) {
                authHeader = config.token;
              }
            } catch (e) {
              console.error('[Get Models] Error reading config:', e);
            }
          }
        }

        if (!authHeader) {
          console.log('[Get Models] No auth available, returning default models');
          resolve({ models: provider.defaultModels() });
          return;
        }

        // Make API call to list models
        const options = {
          hostname: 'api.anthropic.com',
          path: '/v1/models',
          method: 'GET',
          headers: {
            'x-api-key': authHeader,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        };

        const req = https.request(options, (res: any) => {
          let data = '';
          
          res.on('data', (chunk: any) => {
            data += chunk;
          });
          
          res.on('end', () => {
            console.log('[Get Models] API Response:', data.substring(0, 200));
            
            try {
              const response = JSON.parse(data);
              
              if (response.data && Array.isArray(response.data)) {
                const models = response.data.map((m: any) => m.id);
                console.log('[Get Models] Found models:', models);
                resolve({ models });
              } else {
                console.log('[Get Models] Unexpected response format, using defaults');
                resolve({
                  models: [
                    'claude-opus-4-7',
                    'claude-sonnet-4-6',
                    'claude-opus-4-6',
                    'claude-sonnet-4-5-20250929',
                    'claude-haiku-4-5-20251001',
                    'claude-opus-4-5-20251101'
                  ]
                });
              }
            } catch (e) {
              console.error('[Get Models] Parse error:', e);
              resolve({
                models: [
                  'claude-opus-4-7',
                  'claude-sonnet-4-6',
                  'claude-opus-4-6',
                  'claude-sonnet-4-5-20250929',
                  'claude-haiku-4-5-20251001',
                  'claude-opus-4-5-20251101'
                ]
              });
            }
          });
        });

        req.on('error', (error: any) => {
          console.error('[Get Models] Request error:', error);
          resolve({
            models: [
              'claude-opus-4-7',
              'claude-sonnet-4-6',
              'claude-opus-4-6',
              'claude-sonnet-4-5-20250929',
              'claude-haiku-4-5-20251001',
              'claude-opus-4-5-20251101'
            ],
            error: error.message
          });
        });

        req.end();
      });
    } catch (error: any) {
      console.error('[Get Models] Exception:', error);
      return {
        models: [
          'claude-opus-4-7',
          'claude-sonnet-4-6',
          'claude-opus-4-6',
          'claude-sonnet-4-5-20250929',
          'claude-haiku-4-5-20251001',
          'claude-opus-4-5-20251101'
        ],
        error: error.message
      };
    }
  });

  ipcMain.handle('verifyClaudeAuth', async (_event, profileName) => {
    return getProvider('claude').verifyAuth(profileName);
  });

  ipcMain.handle('verifyGeminiAuth', async (_event, profileName) => {
    return getProvider('gemini').verifyAuth(profileName);
  });

  ipcMain.handle('verifyCodexAuth', async (_event, profileName) => {
    return getProvider('codex').verifyAuth(profileName);
  });

  ipcMain.handle('getProviderAuthCommand', (_event, provider, profileName) => {
    return getProvider(provider).authCommand(String(profileName || ''));
  });

  ipcMain.handle('transferSession', async (_event, payload) => {
    const db = getDb();
    try {
      const sourceSessionId = payload?.sourceSessionId;
      const targetProfileId = payload?.targetProfileId;
      if (!sourceSessionId || !targetProfileId) {
        return { success: false, message: 'sourceSessionId and targetProfileId are required' };
      }

      const source: any = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sourceSessionId);
      if (!source) return { success: false, message: 'Source session not found' };

      const sourceProfile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(source.profile_id);
      const targetProfile: any = db.prepare('SELECT * FROM profiles WHERE id = ?').get(targetProfileId);
      if (!targetProfile) return { success: false, message: 'Target profile not found' };
      if (targetProfile.id === source.profile_id) {
        return { success: false, message: 'Pick a different profile to continue with' };
      }

      const sourceProvider = getProviderForProfile(sourceProfile);
      const targetProvider = getProviderForProfile(targetProfile);

      // Ensure target CLI is installed (or npx is available) before creating the session row.
      try {
        targetProvider.resolveLaunch();
      } catch (e: any) {
        return { success: false, message: e?.message || `${targetProvider.displayName} CLI not found` };
      }

      const snapshotRow: any = db.prepare('SELECT buffer FROM terminal_snapshots WHERE session_id = ?').get(sourceSessionId);
      const handoff = buildHandoffContext({
        provider: sourceProvider.id,
        configDir: sourceProfile?.claude_config_dir,
        workspacePath: source.workspace_path,
        sessionId: source.id,
        terminalBuffer: snapshotRow?.buffer || activeCliSessions[sourceSessionId]?.buffer || '',
        sourceLabel: `${sourceProvider.displayName} (${sourceProfile?.name || 'profile'})`,
      });

      killClaudePty(sourceSessionId);

      const model = payload.model || targetProvider.defaultModels()[0] || source.model;
      const newId = randomUUID();
      const palette = ['#D4A843', '#4CAF7D', '#5B8DEF', '#B583D8', '#5BC6D8', '#E05C5C', '#E08A4D', '#3DB8A0'];
      const existing: any[] = db.prepare('SELECT color FROM sessions').all();
      const counts = new Map<string, number>(palette.map(c => [c, 0]));
      for (const row of existing) {
        if (row.color && counts.has(row.color)) counts.set(row.color, (counts.get(row.color) || 0) + 1);
      }
      let color = palette[0];
      let best = Infinity;
      for (const c of palette) {
        const n = counts.get(c) || 0;
        if (n < best) { color = c; best = n; }
      }
      const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM sessions').get();
      const sortOrder = (maxOrder?.m ?? -1) + 1;

      db.prepare(`
        INSERT INTO sessions (id, profile_id, workspace_path, model, permission_mode, status, color, sort_order, provider, parent_session_id, project_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        targetProfileId,
        source.workspace_path,
        model,
        source.permission_mode || 'default',
        'active',
        color,
        sortOrder,
        normalizeProvider(targetProfile.provider),
        sourceSessionId,
        source.project_id || null,
      );

      // Soft-archive the source so the user doesn't keep burning quota on it.
      try {
        db.prepare(`UPDATE sessions SET status = 'archived' WHERE id = ?`).run(sourceSessionId);
      } catch {
        // non-fatal
      }

      const spawnResult = spawnProviderPty(newId, payload.cols || 80, payload.rows || 30, { initialPrompt: handoff });
      if (!spawnResult.success) {
        return { success: false, message: spawnResult.message || 'Failed to start transferred session', sessionId: newId };
      }

      return { success: true, sessionId: newId };
    } catch (error: any) {
      console.error('[transferSession]', error);
      return { success: false, message: error.message || 'Transfer failed' };
    }
  });

  ipcMain.handle('closeWindow', () => {
    if (mainWindow) mainWindow.close();
  });
  ipcMain.handle('minimizeWindow', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.handle('maximizeWindow', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
}
