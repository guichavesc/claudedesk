import fs from 'fs';
import os from 'os';
import path from 'path';
import { augmentShellEnv } from '../claudeCli.js';
import { resolveCliLaunch } from './resolveCli.js';
import type { ProviderAdapter, SpawnArgsInput } from './types.js';

const NPM_PACKAGE = '@openai/codex';

function expandHome(p: string): string {
  return p.replace(/^~(?=$|[/\\])/, os.homedir());
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  displayName: 'Codex',
  rateLimitPatterns: [
    /rate\s*limit/i,
    /usage\s*limit/i,
    /quota\s+(?:exceeded|exhausted)/i,
    /\b429\b/,
    /too many requests/i,
    /you've hit your/i,
    /insufficient_quota/i,
  ],

  resolveLaunch() {
    return resolveCliLaunch('codex', NPM_PACKAGE);
  },

  resolveBinary(): string {
    return this.resolveLaunch().command;
  },

  installHint(): string {
    return (
      'Optional: install globally for faster startup.\n' +
      '  npm install -g @openai/codex\n' +
      'Without a global install, ClaudeDesk uses: npx -y @openai/codex'
    );
  },

  buildEnv(profile, decryptApiKey): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = augmentShellEnv({ ...process.env, FORCE_COLOR: '1' });
    delete env.CLAUDE_CODE_INSTALLED_VIA_NPM_WRAPPER;

    const home = profile.claude_config_dir
      ? expandHome(profile.claude_config_dir)
      : path.join(os.homedir(), '.codex-profiles', profile.name || 'default');

    try {
      fs.mkdirSync(home, { recursive: true });
    } catch {
      // ignore
    }
    env.CODEX_HOME = home;

    if (profile.auth_type === 'apikey' && profile.keytar_service_key) {
      const key = decryptApiKey(profile.keytar_service_key);
      if (key) {
        env.OPENAI_API_KEY = key;
        env.CODEX_API_KEY = key;
      }
    }

    return env;
  },

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    const { session, resumeMode } = input;

    if (resumeMode === 'resume') {
      const args = ['resume'];
      if (session.provider_session_id) {
        args.push(session.provider_session_id);
      } else {
        args.push('--last');
      }
      if (session.model) {
        args.push('-m', session.model);
      }
      return args;
    }

    if (resumeMode === 'continue') {
      const args = ['resume', '--last'];
      if (session.model) args.push('-m', session.model);
      return args;
    }

    const args: string[] = [];
    if (session.model) {
      args.push('-m', session.model);
    }
    return args;
  },

  defaultModels(): string[] {
    return [
      'gpt-5.1-codex',
      'gpt-5.1',
      'o3',
      'o4-mini',
      'gpt-4.1',
    ];
  },

  resolveConfigHome(profile): string {
    if (profile.claude_config_dir) return expandHome(profile.claude_config_dir);
    return path.join(os.homedir(), '.codex-profiles', profile.name || 'default');
  },

  defaultConfigDir(profileName: string): string {
    return `~/.codex-profiles/${profileName}`;
  },

  authCommand(profileName: string): string {
    const prefix = `mkdir -p ~/.codex-profiles/${profileName} && CODEX_HOME=~/.codex-profiles/${profileName}`;
    try {
      const launch = resolveCliLaunch('codex', NPM_PACKAGE);
      if (launch.viaNpx) {
        return `${prefix} npx -y ${NPM_PACKAGE} login`;
      }
      return `${prefix} codex login`;
    } catch {
      return `${prefix} npx -y ${NPM_PACKAGE} login`;
    }
  },

  verifyAuth(profileName: string) {
    const home = path.join(os.homedir(), '.codex-profiles', profileName);

    try {
      if (!fs.existsSync(home)) {
        return {
          success: false,
          message: 'No Codex profile directory found. Run the login command first.',
        };
      }

      const authJson = path.join(home, 'auth.json');
      if (fs.existsSync(authJson)) {
        try {
          const raw = fs.readFileSync(authJson, 'utf8');
          const json = JSON.parse(raw);
          if (json && (json.tokens || json.access_token || json.refresh_token || json.api_key || Object.keys(json).length > 0)) {
            return { success: true, message: 'ChatGPT / Codex authentication verified!' };
          }
        } catch {
          return { success: true, message: 'Authentication file found.' };
        }
      }

      const files = fs.readdirSync(home);
      if (files.length > 0) {
        return {
          success: true,
          message: 'Codex profile looks initialized. If login failed, re-run the command.',
        };
      }

      return {
        success: false,
        message: 'No credentials found. Complete `codex login` in the terminal, then verify again.',
      };
    } catch {
      return { success: false, message: 'Error checking Codex authentication' };
    }
  },
};
