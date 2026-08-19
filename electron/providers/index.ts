import { claudeAdapter } from './claude.js';
import { geminiAdapter } from './gemini.js';
import { codexAdapter } from './codex.js';
import type { ProviderAdapter, ProviderCliStatus, ProviderId } from './types.js';
import { normalizeProvider } from './types.js';

const adapters: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
};

export function getProvider(id: unknown): ProviderAdapter {
  return adapters[normalizeProvider(id)];
}

export function getProviderForProfile(profile: { provider?: string | null } | null | undefined): ProviderAdapter {
  return getProvider(profile?.provider);
}

/** Soft check used by UI / createProfile — never throws. */
export function checkProviderCli(id: unknown): ProviderCliStatus {
  const adapter = getProvider(id);
  try {
    const launch = adapter.resolveLaunch();
    return {
      available: true,
      path: launch.command,
      viaNpx: launch.viaNpx,
      message: launch.viaNpx
        ? `${adapter.displayName} will run via npx (first launch may download the package).`
        : undefined,
      installHint: adapter.installHint() || undefined,
    };
  } catch (e: any) {
    return {
      available: false,
      message: e?.message || `${adapter.displayName} CLI not found`,
      installHint: adapter.installHint() || undefined,
    };
  }
}

export * from './types.js';
export { claudeAdapter, geminiAdapter, codexAdapter };
