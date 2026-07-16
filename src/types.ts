export interface Profile {
  id: string;
  name: string;
  auth_type: 'subscription' | 'apikey';
  created_at: string;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const DEFAULT_PERMISSION_MODE_KEY = 'claudedesk:defaultPermissionMode';
export const LAST_MODEL_KEY = 'claudedesk:lastModel';
export const SIDEBAR_WIDTH_KEY = 'claudedesk:sidebarWidth';
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 420;

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

export interface Session {
  id: string;
  profile_id: string;
  workspace_path: string;
  model: string;
  permission_mode: PermissionMode;
  status: string;
  started_at: string;
  /** Short AI-generated description of the conversation, when available. */
  title?: string | null;
  /** Hex highlight color for tabs / sidebar identification. */
  color?: string | null;
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
      createProfile: (data: { name: string; authType: string; apiKey?: string }) => Promise<string>;
      deleteProfile: (profileId: string) => Promise<{ success: boolean; message?: string }>;
      getProfileMcpServers: (profileId: string) => Promise<{ servers: McpServerEntry[]; error?: string }>;
      saveProfileMcpServer: (profileId: string, name: string, config: Omit<McpServerEntry, 'name'>, previousName?: string) => Promise<{ success: boolean; message?: string }>;
      deleteProfileMcpServer: (profileId: string, name: string) => Promise<{ success: boolean; message?: string }>;
      getProfilePluginMarketplaces: (profileId: string) => Promise<{ marketplaces: any[]; error?: string; raw?: string }>;
      addProfilePluginMarketplace: (profileId: string, source: string) => Promise<{ success: boolean; message?: string }>;
      removeProfilePluginMarketplace: (profileId: string, name: string) => Promise<{ success: boolean; message?: string }>;
      getProfilePlugins: (profileId: string) => Promise<{ plugins: any[]; error?: string; raw?: string }>;
      installProfilePlugin: (profileId: string, spec: string) => Promise<{ success: boolean; message?: string }>;
      uninstallProfilePlugin: (profileId: string, spec: string) => Promise<{ success: boolean; message?: string }>;
      setProfilePluginEnabled: (profileId: string, spec: string, enabled: boolean) => Promise<{ success: boolean; message?: string }>;
      getSessions: () => Promise<Session[]>;
      getRecentWorkspaces: () => Promise<string[]>;
      createSession: (data: { profileId: string; workspacePath: string; model: string; permissionMode?: PermissionMode }) => Promise<string>;
      deleteSession: (sessionId: string) => Promise<{ success: boolean; message?: string }>;
      updateSessionMode: (sessionId: string, permissionMode: PermissionMode) => Promise<{ success: boolean; message?: string }>;
      updateSessionColor: (sessionId: string, color: string) => Promise<{ success: boolean; message?: string }>;
      restartCliSession: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean; message?: string }>;
      getMessages: (sessionId: string) => Promise<Message[]>;
      saveMessage: (message: Omit<Message, 'id'>) => Promise<string>;
      getAvailableModels: (profileId: string) => Promise<{ models: string[]; error?: string }>;
      // Terminal (PTY)
      startCliSession: (sessionId: string, cols: number, rows: number) => Promise<{ success: boolean; alreadyRunning?: boolean; message?: string }>;
      sendCliInput: (sessionId: string, data: string) => Promise<boolean>;
      resizeCliSession: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
      getTerminalSnapshot: (sessionId: string) => Promise<string | null>;
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
      closeWindow: () => Promise<void>;
      minimizeWindow: () => Promise<void>;
      maximizeWindow: () => Promise<void>;
      getAppVersion: () => Promise<string>;
    };
  }
}
