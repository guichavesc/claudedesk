export type ProviderId = 'claude' | 'gemini' | 'codex';

export interface Profile {
  id: string;
  name: string;
  auth_type: 'subscription' | 'apikey' | 'google' | 'chatgpt' | string;
  provider?: ProviderId | string;
  created_at: string;
}

export function profileProvider(profile?: Profile | null): ProviderId {
  if (profile?.provider === 'gemini') return 'gemini';
  if (profile?.provider === 'codex') return 'codex';
  return 'claude';
}

export function providerDisplayName(provider?: string | null): string {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'codex') return 'Codex';
  return 'Claude';
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const DEFAULT_PERMISSION_MODE_KEY = 'claudedesk:defaultPermissionMode';
export const LAST_MODEL_KEY = 'claudedesk:lastModel';
export const SIDEBAR_WIDTH_KEY = 'claudedesk:sidebarWidth';
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 420;

export const UNCATEGORIZED_PROJECT_ID = '__uncategorized__';

export interface Project {
  id: string;
  name: string;
  sort_order?: number | null;
  created_at: string;
}

export const PERMISSION_MODES: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Prompts for approval before edits and commands' },
  { value: 'acceptEdits', label: 'Auto-Accept Edits', description: 'Automatically accepts file edits' },
  { value: 'plan', label: 'Plan Mode', description: 'Read-only — plans without making changes' },
  { value: 'bypassPermissions', label: 'Bypass Permissions', description: 'Skips all permission prompts (use with care)' },
];

/** Distinct tab highlight colors — assigned on create, changeable later. */
export const SESSION_COLORS = [
  '#D4A843', // amber (app accent)
  '#4CAF7D', // green
  '#5B8DEF', // blue
  '#B583D8', // violet
  '#5BC6D8', // cyan
  '#E05C5C', // rose
  '#E08A4D', // orange
  '#3DB8A0', // teal
] as const;

export type SessionColor = (typeof SESSION_COLORS)[number] | string;

export type SessionStatus = 'active' | 'archived';

export interface Session {
  id: string;
  profile_id: string;
  workspace_path: string;
  model: string;
  permission_mode: PermissionMode;
  status: SessionStatus | string;
  started_at: string;
  /** Short AI-generated description of the conversation, when available. */
  title?: string | null;
  /** Hex highlight color for tabs / sidebar identification. */
  color?: string | null;
  /** User-controlled tab order (lower = further left). */
  sort_order?: number | null;
  /** Provider that owns this session (denormalized from profile). */
  provider?: ProviderId | string | null;
  /** Session this one was transferred from, if any. */
  parent_session_id?: string | null;
  /** Named project this session belongs to, if any. */
  project_id?: string | null;
}

export function isSessionActive(session: Session): boolean {
  return session.status !== 'archived';
}

/** Pick the least-used palette color so new sessions stay visually distinct. */
export function pickSessionColor(existing: Array<{ color?: string | null }>): string {
  const counts = new Map<string, number>();
  for (const c of SESSION_COLORS) counts.set(c, 0);
  for (const s of existing) {
    if (s.color && counts.has(s.color)) {
      counts.set(s.color, (counts.get(s.color) || 0) + 1);
    }
  }
  let best: string = SESSION_COLORS[0];
  let bestCount = Infinity;
  for (const c of SESSION_COLORS) {
    const n = counts.get(c) || 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function sessionColor(session: { color?: string | null }): string {
  return session.color || SESSION_COLORS[0];
}

/** Short title used in the workbench list (no folder suffix). */
export function sessionTitle(session: Session): string {
  if (session.title?.trim()) return session.title.trim();
  return session.workspace_path.split('/').filter(Boolean).pop() || 'Untitled';
}

/** Tab/sidebar label: "Brief description - folder" when titled, else just the folder. */
export function sessionDisplayName(session: Session): string {
  const folder = session.workspace_path.split('/').filter(Boolean).pop() || 'Unknown';
  if (session.title?.trim()) return `${session.title.trim()} - ${folder}`;
  return folder;
}

/** e.g. "Session Started 16th July 2026" */
export function formatSessionStarted(startedAt: string): string {
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" — normalize for Date parsing.
  const normalized = startedAt.includes('T') ? startedAt : startedAt.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return 'Session Started';

  const day = d.getDate();
  const ordinal = (n: number) => {
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return `${n}st`;
    if (j === 2 && k !== 12) return `${n}nd`;
    if (j === 3 && k !== 13) return `${n}rd`;
    return `${n}th`;
  };
  const month = d.toLocaleString('en-GB', { month: 'long' });
  return `Session Started ${ordinal(day)} ${month} ${d.getFullYear()}`;
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalTokens: number;
  requestCount: number;
  found: boolean;
}

/** Compact token counts for the status bar (e.g. 12.4k, 1.2M). */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

export interface Message {
  id?: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  timestamp: string;
}

export type McpServerType = 'stdio' | 'http' | 'sse';

export interface McpServerEntry {
  name: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

declare global {
  interface Window {
    api: {
      getProfiles: () => Promise<Profile[]>;
      createProfile: (data: {
        name: string;
        authType: string;
        apiKey?: string;
        provider?: ProviderId | string;
      }) => Promise<string | { success: boolean; id?: string; message?: string; installHint?: string }>;
      checkProviderCli: (provider: ProviderId | string) => Promise<{
        available: boolean;
        path?: string;
        viaNpx?: boolean;
        message?: string;
        installHint?: string;
      }>;
      deleteProfile: (profileId: string) => Promise<{ success: boolean; message?: string }>;
      getProfileMcpServers: (profileId: string) => Promise<{ servers: McpServerEntry[]; error?: string }>;
      saveProfileMcpServer: (profileId: string, name: string, config: Omit<McpServerEntry, 'name'>, previousName?: string) => Promise<{ success: boolean; message?: string }>;
      deleteProfileMcpServer: (profileId: string, name: string) => Promise<{ success: boolean; message?: string }>;
      getProfilePluginMarketplaces: (profileId: string) => Promise<{ marketplaces: any[]; error?: string; raw?: string }>;
      addProfilePluginMarketplace: (profileId: string, source: string) => Promise<{ success: boolean; message?: string }>;
      removeProfilePluginMarketplace: (profileId: string, name: string) => Promise<{ success: boolean; message?: string }>;
      getProfilePlugins: (profileId: string) => Promise<{ plugins: any[]; error?: string; raw?: string }>;
      getProfileAvailablePlugins: (profileId: string, installedIds?: string[]) => Promise<{ plugins: Array<{ spec: string; name: string; marketplace: string; description?: string; version?: string; installed: boolean }>; error?: string }>;
      installProfilePlugin: (profileId: string, spec: string) => Promise<{ success: boolean; message?: string }>;
      uninstallProfilePlugin: (profileId: string, spec: string) => Promise<{ success: boolean; message?: string }>;
      setProfilePluginEnabled: (profileId: string, spec: string, enabled: boolean) => Promise<{ success: boolean; message?: string }>;
      getProjects: () => Promise<Project[]>;
      createProject: (name: string) => Promise<{ success: boolean; id?: string; message?: string }>;
      renameProject: (projectId: string, name: string) => Promise<{ success: boolean; message?: string }>;
      deleteProject: (projectId: string) => Promise<{ success: boolean; message?: string }>;
      updateSessionProject: (sessionId: string, projectId: string | null) => Promise<{ success: boolean; message?: string }>;
      getRunningSessionIds: () => Promise<string[]>;
      getSessions: () => Promise<Session[]>;
      getRecentWorkspaces: () => Promise<string[]>;
      createSession: (data: { profileId: string; workspacePath: string; model: string; permissionMode?: PermissionMode; projectId?: string | null }) => Promise<string>;
      archiveSession: (sessionId: string) => Promise<{ success: boolean; message?: string }>;
      unarchiveSession: (sessionId: string) => Promise<{ success: boolean; message?: string }>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean; message?: string }>;
      updateSessionMode: (sessionId: string, permissionMode: PermissionMode) => Promise<{ success: boolean; message?: string }>;
      updateSessionColor: (sessionId: string, color: string) => Promise<{ success: boolean; message?: string }>;
      updateSessionTitle: (sessionId: string, title: string) => Promise<{ success: boolean; title?: string | null; message?: string }>;
      reorderSessions: (orderedIds: string[]) => Promise<{ success: boolean; message?: string }>;
      restartCliSession: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean; message?: string }>;
      getMessages: (sessionId: string) => Promise<Message[]>;
      saveMessage: (message: Omit<Message, 'id'>) => Promise<string>;
      getAvailableModels: (profileId: string) => Promise<{ models: string[]; error?: string }>;
      // Terminal (PTY)
      startCliSession: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean; alreadyRunning?: boolean; message?: string }>;
      sendCliInput: (sessionId: string, data: string) => Promise<boolean>;
      resizeCliSession: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
      getTerminalSnapshot: (sessionId: string) => Promise<string | null>;
      getSessionTokenUsage: (sessionId: string) => Promise<SessionTokenUsage>;
      onPtyOutput: (callback: (sessionId: string, data: string) => void) => () => void;
      onPtyExit: (callback: (sessionId: string, exitCode: number) => void) => () => void;
      onSessionTitleUpdated: (callback: (sessionId: string, title: string) => void) => () => void;
      getGitDiff: (workspacePath: string) => Promise<{ diff?: string; status?: string; branch?: string; error?: string }>;
      getGitBranches: (workspacePath: string) => Promise<{ branches: string[]; current: string; error?: string }>;
      checkoutGitBranch: (workspacePath: string, branchName: string) => Promise<{ success: boolean; message?: string }>;
      createGitBranch: (workspacePath: string, branchName: string) => Promise<{ success: boolean; message?: string }>;
      gitCommit: (workspacePath: string, message: string, filePaths: string[]) => Promise<{ success: boolean; message?: string }>;
      gitPush: (workspacePath: string) => Promise<{ success: boolean; message?: string }>;
      exportSession: (sessionId: string) => Promise<boolean>;
      exportSessionSummary: (sessionId: string) => Promise<{ success: boolean; message?: string }>;
      selectDirectory: () => Promise<string | null>;
      openWorkspaceFolder: (workspacePath: string) => Promise<boolean>;
      startClaudeAuth: (profileName: string) => Promise<{ success: boolean; message?: string }>;
      verifyClaudeAuth: (profileName: string) => Promise<{ success: boolean; message?: string }>;
      verifyGeminiAuth: (profileName: string) => Promise<{ success: boolean; message?: string }>;
      verifyCodexAuth: (profileName: string) => Promise<{ success: boolean; message?: string }>;
      getProviderAuthCommand: (provider: ProviderId | string, profileName: string) => Promise<string>;
      transferSession: (data: {
        sourceSessionId: string;
        targetProfileId: string;
        model?: string;
        cols?: number;
        rows?: number;
      }) => Promise<{ success: boolean; sessionId?: string; message?: string }>;
      onSessionLimitDetected: (callback: (sessionId: string) => void) => () => void;
      closeWindow: () => Promise<void>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      getAppVersion: () => Promise<string>;
    };
  }
}
