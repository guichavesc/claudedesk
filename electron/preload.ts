import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Profiles
  getProfiles: () => ipcRenderer.invoke('getProfiles'),
  createProfile: (profileData: any) => ipcRenderer.invoke('createProfile', profileData),
  checkProviderCli: (provider: string) => ipcRenderer.invoke('checkProviderCli', provider),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('deleteProfile', profileId),

  // Projects
  getProjects: () => ipcRenderer.invoke('getProjects'),
  createProject: (name: string) => ipcRenderer.invoke('createProject', name),
  renameProject: (projectId: string, name: string) => ipcRenderer.invoke('renameProject', projectId, name),
  deleteProject: (projectId: string) => ipcRenderer.invoke('deleteProject', projectId),
  updateSessionProject: (sessionId: string, projectId: string | null) =>
    ipcRenderer.invoke('updateSessionProject', sessionId, projectId),
  getRunningSessionIds: () => ipcRenderer.invoke('getRunningSessionIds'),
  
  // Sessions
  getSessions: () => ipcRenderer.invoke('getSessions'),
  getRecentWorkspaces: () => ipcRenderer.invoke('getRecentWorkspaces'),
  createSession: (sessionData: any) => ipcRenderer.invoke('createSession', sessionData),
  archiveSession: (sessionId: string) => ipcRenderer.invoke('archiveSession', sessionId),
  unarchiveSession: (sessionId: string) => ipcRenderer.invoke('unarchiveSession', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('deleteSession', sessionId),
  updateSessionMode: (sessionId: string, permissionMode: string) => ipcRenderer.invoke('updateSessionMode', sessionId, permissionMode),
  updateSessionColor: (sessionId: string, color: string) => ipcRenderer.invoke('updateSessionColor', sessionId, color),
  updateSessionTitle: (sessionId: string, title: string) => ipcRenderer.invoke('updateSessionTitle', sessionId, title),
  reorderSessions: (orderedIds: string[]) => ipcRenderer.invoke('reorderSessions', orderedIds),
  restartCliSession: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('restartCliSession', sessionId, cols, rows),
  getMessages: (sessionId: string) => ipcRenderer.invoke('getMessages', sessionId),
  saveMessage: (message: any) => ipcRenderer.invoke('saveMessage', message),
  getAvailableModels: (profileId: string) => ipcRenderer.invoke('getAvailableModels', profileId),
  
  // Terminal (PTY)
  startCliSession: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('startCliSession', sessionId, cols, rows),
  sendCliInput: (sessionId: string, data: string) => ipcRenderer.invoke('sendCliInput', sessionId, data),
  resizeCliSession: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('resizeCliSession', sessionId, cols, rows),
  getTerminalSnapshot: (sessionId: string) => ipcRenderer.invoke('getTerminalSnapshot', sessionId),
  getSessionTokenUsage: (sessionId: string) => ipcRenderer.invoke('getSessionTokenUsage', sessionId),
  onPtyOutput: (callback: (sessionId: string, data: string) => void) => {
    const listener = (_event: any, sessionId: string, data: string) => callback(sessionId, data);
    ipcRenderer.on('pty-output', listener);
    return () => ipcRenderer.removeListener('pty-output', listener);
  },
  onPtyExit: (callback: (sessionId: string, exitCode: number) => void) => {
    const listener = (_event: any, sessionId: string, exitCode: number) => callback(sessionId, exitCode);
    ipcRenderer.on('pty-exit', listener);
    return () => ipcRenderer.removeListener('pty-exit', listener);
  },
  onSessionTitleUpdated: (callback: (sessionId: string, title: string) => void) => {
    const listener = (_event: any, sessionId: string, title: string) => callback(sessionId, title);
    ipcRenderer.on('session-title-updated', listener);
    return () => ipcRenderer.removeListener('session-title-updated', listener);
  },
  
  // Per-profile MCP servers
  getProfileMcpServers: (profileId: string) => ipcRenderer.invoke('getProfileMcpServers', profileId),
  saveProfileMcpServer: (profileId: string, name: string, config: any, previousName?: string) =>
    ipcRenderer.invoke('saveProfileMcpServer', profileId, name, config, previousName),
  deleteProfileMcpServer: (profileId: string, name: string) => ipcRenderer.invoke('deleteProfileMcpServer', profileId, name),

  // Per-profile plugins
  getProfilePluginMarketplaces: (profileId: string) => ipcRenderer.invoke('getProfilePluginMarketplaces', profileId),
  addProfilePluginMarketplace: (profileId: string, source: string) => ipcRenderer.invoke('addProfilePluginMarketplace', profileId, source),
  removeProfilePluginMarketplace: (profileId: string, name: string) => ipcRenderer.invoke('removeProfilePluginMarketplace', profileId, name),
  getProfilePlugins: (profileId: string) => ipcRenderer.invoke('getProfilePlugins', profileId),
  getProfileAvailablePlugins: (profileId: string, installedIds?: string[]) =>
    ipcRenderer.invoke('getProfileAvailablePlugins', profileId, installedIds || []),
  installProfilePlugin: (profileId: string, spec: string) => ipcRenderer.invoke('installProfilePlugin', profileId, spec),
  uninstallProfilePlugin: (profileId: string, spec: string) => ipcRenderer.invoke('uninstallProfilePlugin', profileId, spec),
  setProfilePluginEnabled: (profileId: string, spec: string, enabled: boolean) =>
    ipcRenderer.invoke('setProfilePluginEnabled', profileId, spec, enabled),

  // Git
  getGitDiff: (workspacePath: string) => ipcRenderer.invoke('getGitDiff', workspacePath),
  getGitBranches: (workspacePath: string) => ipcRenderer.invoke('getGitBranches', workspacePath),
  checkoutGitBranch: (workspacePath: string, branchName: string) => ipcRenderer.invoke('checkoutGitBranch', workspacePath, branchName),
  createGitBranch: (workspacePath: string, branchName: string) => ipcRenderer.invoke('createGitBranch', workspacePath, branchName),
  gitCommit: (workspacePath: string, message: string, filePaths: string[]) => ipcRenderer.invoke('gitCommit', workspacePath, message, filePaths),
  gitPush: (workspacePath: string) => ipcRenderer.invoke('gitPush', workspacePath),
  exportSession: (sessionId: string) => ipcRenderer.invoke('exportSession', sessionId),
  exportSessionSummary: (sessionId: string) => ipcRenderer.invoke('exportSessionSummary', sessionId),
  
  // File System
  selectDirectory: () => ipcRenderer.invoke('selectDirectory'),
  openWorkspaceFolder: (workspacePath: string) => ipcRenderer.invoke('openWorkspaceFolder', workspacePath),
  startClaudeAuth: (profileName: string) => ipcRenderer.invoke('startClaudeAuth', profileName),
  verifyClaudeAuth: (profileName: string) => ipcRenderer.invoke('verifyClaudeAuth', profileName),
  verifyGeminiAuth: (profileName: string) => ipcRenderer.invoke('verifyGeminiAuth', profileName),
  verifyCodexAuth: (profileName: string) => ipcRenderer.invoke('verifyCodexAuth', profileName),
  getProviderAuthCommand: (provider: string, profileName: string) =>
    ipcRenderer.invoke('getProviderAuthCommand', provider, profileName),
  transferSession: (data: any) => ipcRenderer.invoke('transferSession', data),
  onSessionLimitDetected: (callback: (sessionId: string) => void) => {
    const listener = (_event: any, sessionId: string) => callback(sessionId);
    ipcRenderer.on('session-limit-detected', listener);
    return () => ipcRenderer.removeListener('session-limit-detected', listener);
  },
  
  // Window
  closeWindow: () => ipcRenderer.invoke('closeWindow'),
  minimizeWindow: () => ipcRenderer.invoke('minimizeWindow'),
  maximizeWindow: () => ipcRenderer.invoke('maximizeWindow'),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
});
