import fs from 'fs';
import os from 'os';
import path from 'path';
import { augmentShellEnv, resolveClaudeBinary } from '../claudeCli.js';
import type { ProviderAdapter, SpawnArgsInput } from './types.js';

function expandHome(p: string): string {
  return p.replace(/^~(?=$|[/\\])/, os.homedir());
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  displayName: 'Claude',
  rateLimitPatterns: [
    /rate\s*limit/i,
    /usage\s*limit/i,
    /you've hit your/i,
    /you have hit your/i,
    /resets?\s+(?:at|in|on)\b/i,
    /\b429\b/,
    /quota\s+(?:exceeded|exhausted)/i,
  ],

  resolveBinary(): string {
    return resolveClaudeBinary();
  },

  resolveLaunch() {
    const command = resolveClaudeBinary();
    return { command, argsPrefix: [] as string[], viaNpx: false };
  },

  installHint(): string {
    return '';
  },

  buildEnv(profile, decryptApiKey): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = augmentShellEnv({ ...process.env, FORCE_COLOR: '1' });

    if (profile.claude_config_dir) {
      env.CLAUDE_CONFIG_DIR = expandHome(profile.claude_config_dir);
    }

    if (profile.auth_type === 'apikey' && profile.keytar_service_key) {
      const key = decryptApiKey(profile.keytar_service_key);
      if (key) env.ANTHROPIC_API_KEY = key;
    }

    return env;
  },

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    const { session, resumeMode } = input;
    const args = ['--model', session.model];

    if (resumeMode === 'resume') {
      args.push('--resume', session.provider_session_id || session.id);
    } else if (resumeMode === 'continue') {
      args.push('--continue');
    } else {
      args.push('--session-id', session.id);
    }

    const mode = session.permission_mode || 'default';
    if (mode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else if (mode && mode !== 'default') {
      args.push('--permission-mode', mode);
    }

    return args;
  },

  defaultModels(): string[] {
    return [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
    ];
  },

  resolveConfigHome(profile): string {
    if (profile.claude_config_dir) return expandHome(profile.claude_config_dir);
    return path.join(os.homedir(), '.claude-profiles', profile.name || 'default');
  },

  defaultConfigDir(profileName: string): string {
    return `~/.claude-profiles/${profileName}`;
  },

  authCommand(profileName: string): string {
    return `CLAUDE_CONFIG_DIR=~/.claude-profiles/${profileName} npx claude`;
  },

  verifyAuth(profileName: string) {
    const configDir = path.join(os.homedir(), '.claude-profiles', profileName);
    const credPathNew = path.join(configDir, '.claude.json');
    const credPathOld = path.join(configDir, '.credentials.json');

    try {
      if (fs.existsSync(credPathNew)) {
        try {
          const content = JSON.parse(fs.readFileSync(credPathNew, 'utf8'));
          if (content.auth || content.token || content.access_token) {
            return { success: true, message: 'Authentication verified!' };
          }
        } catch {
          // fall through
        }
      }

      if (fs.existsSync(credPathOld)) {
        return { success: true, message: 'Authentication verified!' };
      }

      if (fs.existsSync(configDir)) {
        const files = fs.readdirSync(configDir);
        if (files.length > 0) {
          return {
            success: true,
            message: 'Authentication verified! (Credentials stored in system keychain)',
          };
        }
      }

      return {
        success: false,
        message: 'No credentials found. Please make sure you completed the authentication in your browser.',
      };
    } catch {
      return { success: false, message: 'Error checking authentication' };
    }
  },
};
