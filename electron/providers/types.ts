export type ProviderId = 'claude' | 'gemini' | 'codex';

export type ResumeMode = 'new' | 'resume' | 'continue';

export interface SpawnArgsInput {
  session: {
    id: string;
    model: string;
    permission_mode?: string | null;
    provider_session_id?: string | null;
  };
  resumeMode: ResumeMode;
  /** Optional first-turn prompt (used after transfer). Written via PTY after spawn when set. */
  initialPrompt?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  /** Patterns that indicate a usage/rate limit in PTY output. */
  rateLimitPatterns: RegExp[];
  /**
   * Resolve how to launch this CLI. Prefer a global binary; Gemini/Codex may
   * fall back to `npx -y <package>` when not installed.
   */
  resolveLaunch(): { command: string; argsPrefix: string[]; viaNpx: boolean };
  /** @deprecated Prefer resolveLaunch — kept for simple binary-only checks. */
  resolveBinary(): string;
  /** How to install this CLI when missing (shown in UI). Empty for bundled Claude. */
  installHint(): string;
  buildEnv(profile: any, decryptApiKey: (encrypted: string) => string | null): NodeJS.ProcessEnv;
  buildSpawnArgs(input: SpawnArgsInput): string[];
  /** Default models when live listing is unavailable. */
  defaultModels(): string[];
  /** Absolute config / home path for this profile. */
  resolveConfigHome(profile: any): string;
  /** Check Google/subscription-style credentials on disk. */
  verifyAuth(profileName: string): { success: boolean; message: string };
  /** Shell command the user runs to complete interactive login. */
  authCommand(profileName: string): string;
  /** Default relative config home for a new profile name. */
  defaultConfigDir(profileName: string): string;
}

export interface ProviderCliStatus {
  available: boolean;
  path?: string;
  viaNpx?: boolean;
  message?: string;
  installHint?: string;
}

export function normalizeProvider(value: unknown): ProviderId {
  if (value === 'gemini') return 'gemini';
  if (value === 'codex') return 'codex';
  return 'claude';
}

export function isProviderBound(session: any): boolean {
  if (session?.provider_bound != null) return !!session.provider_bound;
  return !!session?.claude_bound;
}
