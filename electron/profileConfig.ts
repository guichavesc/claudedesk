import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { augmentShellEnv, resolveClaudeBinary } from './claudeCli.js';

// Each profile already gets its own CLAUDE_CONFIG_DIR (see buildClaudeEnv in main.ts),
// which is where Claude Code stores `.claude.json` (MCP servers) and `settings.json`
// (enabled plugins). Reusing that directory means MCP servers and plugins configured
// here are naturally scoped to the profile that owns them — no extra state to track.
export function resolveConfigDir(profile: any): string {
  const dir = profile?.claude_config_dir || '~/.claude-profiles/default';
  return dir.replace('~', os.homedir());
}

function readJsonFile(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('[ProfileConfig] Failed to read', filePath, e);
    return {};
  }
}

function writeJsonFile(filePath: string, data: any) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function claudeJsonPath(profile: any): string {
  return path.join(resolveConfigDir(profile), '.claude.json');
}

function settingsJsonPath(profile: any): string {
  return path.join(resolveConfigDir(profile), 'settings.json');
}

export interface McpServerEntry {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export function listMcpServers(profile: any): McpServerEntry[] {
  const data = readJsonFile(claudeJsonPath(profile));
  const servers = data.mcpServers || {};
  return Object.entries(servers).map(([name, cfg]: [string, any]) => ({
    name,
    type: cfg.type || (cfg.url ? 'http' : 'stdio'),
    ...cfg,
  }));
}

export function saveMcpServer(profile: any, name: string, config: Omit<McpServerEntry, 'name'>, previousName?: string): { success: boolean; message?: string } {
  try {
    const filePath = claudeJsonPath(profile);
    const data = readJsonFile(filePath);
    if (!data.mcpServers) data.mcpServers = {};
    if (previousName && previousName !== name) {
      delete data.mcpServers[previousName];
    }
    data.mcpServers[name] = config;
    writeJsonFile(filePath, data);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to save MCP server' };
  }
}

export function deleteMcpServer(profile: any, name: string): { success: boolean; message?: string } {
  try {
    const filePath = claudeJsonPath(profile);
    const data = readJsonFile(filePath);
    if (data.mcpServers) delete data.mcpServers[name];
    writeJsonFile(filePath, data);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to delete MCP server' };
  }
}

interface CliResult {
  success: boolean;
  stdout: string;
  message?: string;
}

// Plugin/marketplace management involves git clones and network access, so it's run
// through the real `claude plugin` CLI (scoped to this profile's CLAUDE_CONFIG_DIR)
// rather than hand-editing config — that keeps us correct across CLI versions instead
// of reverse-engineering an internal cache format.
function runClaudeCli(env: NodeJS.ProcessEnv, args: string[], timeoutMs = 60_000): Promise<CliResult> {
  return new Promise((resolve) => {
    let binary: string;
    try {
      binary = resolveClaudeBinary();
    } catch (e: any) {
      resolve({ success: false, stdout: '', message: e?.message || 'Claude CLI not found' });
      return;
    }

    const child = spawn(binary, args, { cwd: os.homedir(), env: augmentShellEnv(env) });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ success: false, stdout, message: 'Command timed out' });
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, stdout, message: err.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ success: true, stdout });
      } else {
        resolve({ success: false, stdout, message: stderr.trim() || stdout.trim() || `claude exited with code ${code}` });
      }
    });
  });
}

// The CLI's JSON output shape has shifted across versions (sometimes a bare array,
// sometimes wrapped in a named key) — parse defensively and surface raw output on
// failure instead of crashing the UI.
function parseJsonList(stdout: string, wrapperKeys: string[]): any[] {
  const parsed = JSON.parse(stdout);
  if (Array.isArray(parsed)) return parsed;
  for (const key of wrapperKeys) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return [];
}

export async function listPluginMarketplaces(env: NodeJS.ProcessEnv) {
  const res = await runClaudeCli(env, ['plugin', 'marketplace', 'list', '--json'], 30_000);
  if (!res.success) return { marketplaces: [], error: res.message };
  try {
    return { marketplaces: parseJsonList(res.stdout, ['marketplaces']) };
  } catch (e) {
    return { marketplaces: [], error: 'Could not parse marketplace list', raw: res.stdout };
  }
}

export async function addPluginMarketplace(env: NodeJS.ProcessEnv, source: string) {
  const res = await runClaudeCli(env, ['plugin', 'marketplace', 'add', source, '--scope', 'user'], 120_000);
  return { success: res.success, message: res.message || (res.success ? `Added marketplace "${source}"` : undefined) };
}

export async function removePluginMarketplace(env: NodeJS.ProcessEnv, name: string) {
  const res = await runClaudeCli(env, ['plugin', 'marketplace', 'remove', name, '--scope', 'user'], 30_000);
  return { success: res.success, message: res.message || (res.success ? `Removed marketplace "${name}"` : undefined) };
}

export async function listPlugins(env: NodeJS.ProcessEnv) {
  const res = await runClaudeCli(env, ['plugin', 'list', '--json'], 30_000);
  if (!res.success) return { plugins: [], error: res.message };
  try {
    return { plugins: parseJsonList(res.stdout, ['installed', 'plugins']) };
  } catch (e) {
    return { plugins: [], error: 'Could not parse plugin list', raw: res.stdout };
  }
}

export async function installPlugin(env: NodeJS.ProcessEnv, spec: string) {
  const res = await runClaudeCli(env, ['plugin', 'install', spec, '--scope', 'user'], 120_000);
  return { success: res.success, message: res.message || (res.success ? `Installed "${spec}"` : undefined) };
}

export async function uninstallPlugin(env: NodeJS.ProcessEnv, spec: string) {
  const res = await runClaudeCli(env, ['plugin', 'uninstall', spec, '--scope', 'user'], 30_000);
  return { success: res.success, message: res.message || (res.success ? `Uninstalled "${spec}"` : undefined) };
}

export interface AvailableMarketplacePlugin {
  spec: string;
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installed: boolean;
}

/**
 * Plugins that ship inside known marketplaces but may not be installed yet.
 * Claude Code only loads skills/MCP from *installed + enabled* plugins — adding
 * a marketplace alone is not enough.
 */
export function listAvailableMarketplacePlugins(profile: any, installedIds: string[] = []): { plugins: AvailableMarketplacePlugin[] } {
  const installed = new Set(installedIds);
  const configDir = resolveConfigDir(profile);
  const marketplacesRoot = path.join(configDir, 'plugins', 'marketplaces');
  const knownPath = path.join(configDir, 'plugins', 'known_marketplaces.json');
  const known = readJsonFile(knownPath);
  const results: AvailableMarketplacePlugin[] = [];
  const seen = new Set<string>();

  const marketplaceNames = new Set<string>();
  if (known && typeof known === 'object') {
    for (const name of Object.keys(known)) marketplaceNames.add(name);
  }
  try {
    if (fs.existsSync(marketplacesRoot)) {
      for (const entry of fs.readdirSync(marketplacesRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) marketplaceNames.add(entry.name);
      }
    }
  } catch {
    // ignore
  }

  for (const marketplace of marketplaceNames) {
    const installLocation =
      known?.[marketplace]?.installLocation || path.join(marketplacesRoot, marketplace);
    const manifestCandidates = [
      path.join(installLocation, '.claude-plugin', 'marketplace.json'),
      path.join(installLocation, '.agents', 'plugins', 'marketplace.json'),
      path.join(installLocation, 'marketplace.json'),
    ];

    let plugins: any[] = [];
    for (const candidate of manifestCandidates) {
      const data = readJsonFile(candidate);
      if (Array.isArray(data?.plugins) && data.plugins.length > 0) {
        plugins = data.plugins;
        break;
      }
    }

    // Single-plugin marketplaces often only have plugin.json at the root.
    if (plugins.length === 0) {
      const pluginJson = readJsonFile(path.join(installLocation, '.claude-plugin', 'plugin.json'));
      if (pluginJson?.name) {
        plugins = [pluginJson];
      }
    }

    for (const p of plugins) {
      const name = p?.name;
      if (!name || typeof name !== 'string') continue;
      const spec = `${name}@${marketplace}`;
      if (seen.has(spec)) continue;
      seen.add(spec);
      results.push({
        spec,
        name,
        marketplace,
        description: typeof p.description === 'string' ? p.description : undefined,
        version: typeof p.version === 'string' ? p.version : undefined,
        installed: installed.has(spec) || installed.has(name),
      });
    }
  }

  results.sort((a, b) => a.spec.localeCompare(b.spec));
  return { plugins: results };
}

// Enabled/disabled state is plain config (`settings.json`'s `enabledPlugins` map), so
// it's safe — and much faster — to flip directly rather than shelling out.
export function setPluginEnabled(profile: any, spec: string, enabled: boolean): { success: boolean; message?: string } {
  try {
    const filePath = settingsJsonPath(profile);
    const data = readJsonFile(filePath);
    if (!data.enabledPlugins) data.enabledPlugins = {};
    data.enabledPlugins[spec] = enabled;
    writeJsonFile(filePath, data);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to update plugin state' };
  }
}
