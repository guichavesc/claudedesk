import fs from 'fs';
import os from 'os';
import path from 'path';
import { augmentShellEnv } from '../claudeCli.js';
import { resolveCliLaunch } from './resolveCli.js';
import type { ProviderAdapter, SpawnArgsInput } from './types.js';

const NPM_PACKAGE = '@google/gemini-cli';

function expandHome(p: string): string {
  return p.replace(/^~(?=$|[/\\])/, os.homedir());
}

/** Gemini stores state under `{GEMINI_CLI_HOME}/.gemini/`. */
function geminiDirForHome(home: string): string {
  return path.join(expandHome(home), '.gemini');
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  displayName: 'Gemini',
  rateLimitPatterns: [
    /rate\s*limit/i,
    /usage\s*limit/i,
    /quota\s+(?:exceeded|exhausted)/i,
    /resource\s*exhausted/i,
    /\b429\b/,
    /too many requests/i,
  ],

  resolveLaunch() {
    return resolveCliLaunch('gemini', NPM_PACKAGE);
  },

  resolveBinary(): string {
    return this.resolveLaunch().command;
  },

  installHint(): string {
    return (
      'Optional: install globally for faster startup.\n' +
      '  npm install -g @google/gemini-cli\n' +
      '  # or: brew install gemini-cli\n' +
      'Without a global install, ClaudeDesk uses: npx -y @google/gemini-cli'
    );
  },

  buildEnv(profile, decryptApiKey): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = augmentShellEnv({ ...process.env, FORCE_COLOR: '1' });
    delete env.CLAUDE_CODE_INSTALLED_VIA_NPM_WRAPPER;

    const home = profile.claude_config_dir
      ? expandHome(profile.claude_config_dir)
      : path.join(os.homedir(), '.gemini-profiles', profile.name || 'default');
    env.GEMINI_CLI_HOME = home;

    if (profile.auth_type === 'apikey' && profile.keytar_service_key) {
      const key = decryptApiKey(profile.keytar_service_key);
      if (key) env.GEMINI_API_KEY = key;
    }

    return env;
  },

  buildSpawnArgs(input: SpawnArgsInput): string[] {
    const { session, resumeMode } = input;
    const args: string[] = [];

    if (session.model) {
      args.push('--model', session.model);
    }

    if (resumeMode === 'resume') {
      const resumeId = session.provider_session_id || session.id;
      args.push('--resume', resumeId);
    }

    return args;
  },

  defaultModels(): string[] {
    return [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-pro',
    ];
  },

  resolveConfigHome(profile): string {
    if (profile.claude_config_dir) return expandHome(profile.claude_config_dir);
    return path.join(os.homedir(), '.gemini-profiles', profile.name || 'default');
  },

  defaultConfigDir(profileName: string): string {
    return `~/.gemini-profiles/${profileName}`;
  },

  authCommand(profileName: string): string {
    try {
      const launch = resolveCliLaunch('gemini', NPM_PACKAGE);
      if (launch.viaNpx) {
        return `GEMINI_CLI_HOME=~/.gemini-profiles/${profileName} npx -y ${NPM_PACKAGE}`;
      }
      return `GEMINI_CLI_HOME=~/.gemini-profiles/${profileName} gemini`;
    } catch {
      return `GEMINI_CLI_HOME=~/.gemini-profiles/${profileName} npx -y ${NPM_PACKAGE}`;
    }
  },

  verifyAuth(profileName: string) {
    const home = path.join(os.homedir(), '.gemini-profiles', profileName);
    const geminiDir = geminiDirForHome(home);

    try {
      if (!fs.existsSync(geminiDir)) {
        return {
          success: false,
          message: 'No Gemini config found. Run the command and complete Login with Google first.',
        };
      }

      const oauthCandidates = [
        path.join(geminiDir, 'oauth_creds.json'),
        path.join(geminiDir, 'google_accounts.json'),
        path.join(geminiDir, 'settings.json'),
      ];

      for (const p of oauthCandidates) {
        if (!fs.existsSync(p)) continue;
        try {
          const raw = fs.readFileSync(p, 'utf8');
          if (p.endsWith('oauth_creds.json') && raw.trim()) {
            return { success: true, message: 'Google authentication verified!' };
          }
          if (p.endsWith('google_accounts.json')) {
            const json = JSON.parse(raw);
            if (json && (Array.isArray(json) ? json.length > 0 : Object.keys(json).length > 0)) {
              return { success: true, message: 'Google authentication verified!' };
            }
          }
          if (p.endsWith('settings.json')) {
            const json = JSON.parse(raw);
            const authType = json?.security?.auth?.selectedType || json?.selectedAuthType;
            if (authType && /oauth|google/i.test(String(authType))) {
              return { success: true, message: 'Google authentication verified!' };
            }
          }
        } catch {
          // try next
        }
      }

      const files = fs.readdirSync(geminiDir);
      if (files.length > 0) {
        return {
          success: true,
          message: 'Gemini profile directory looks initialized. If login failed, re-run the command.',
        };
      }

      return {
        success: false,
        message: 'No credentials found. Complete Login with Google in the terminal, then verify again.',
      };
    } catch {
      return { success: false, message: 'Error checking Gemini authentication' };
    }
  },
};
