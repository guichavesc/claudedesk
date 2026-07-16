let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("api", {
	getProfiles: () => electron.ipcRenderer.invoke("getProfiles"),
	createProfile: (profileData) => electron.ipcRenderer.invoke("createProfile", profileData),
	deleteProfile: (profileId) => electron.ipcRenderer.invoke("deleteProfile", profileId),
	getSessions: () => electron.ipcRenderer.invoke("getSessions"),
	getRecentWorkspaces: () => electron.ipcRenderer.invoke("getRecentWorkspaces"),
	createSession: (sessionData) => electron.ipcRenderer.invoke("createSession", sessionData),
	deleteSession: (sessionId) => electron.ipcRenderer.invoke("deleteSession", sessionId),
	updateSessionMode: (sessionId, permissionMode) => electron.ipcRenderer.invoke("updateSessionMode", sessionId, permissionMode),
	updateSessionColor: (sessionId, color) => electron.ipcRenderer.invoke("updateSessionColor", sessionId, color),
	restartCliSession: (sessionId, cols, rows) => electron.ipcRenderer.invoke("restartCliSession", sessionId, cols, rows),
	getMessages: (sessionId) => electron.ipcRenderer.invoke("getMessages", sessionId),
	saveMessage: (message) => electron.ipcRenderer.invoke("saveMessage", message),
	getAvailableModels: (profileId) => electron.ipcRenderer.invoke("getAvailableModels", profileId),
	startCliSession: (sessionId, cols, rows) => electron.ipcRenderer.invoke("startCliSession", sessionId, cols, rows),
	sendCliInput: (sessionId, data) => electron.ipcRenderer.invoke("sendCliInput", sessionId, data),
	resizeCliSession: (sessionId, cols, rows) => electron.ipcRenderer.invoke("resizeCliSession", sessionId, cols, rows),
	getTerminalSnapshot: (sessionId) => electron.ipcRenderer.invoke("getTerminalSnapshot", sessionId),
	onPtyOutput: (callback) => {
		const listener = (_event, sessionId, data) => callback(sessionId, data);
		electron.ipcRenderer.on("pty-output", listener);
		return () => electron.ipcRenderer.removeListener("pty-output", listener);
	},
	onPtyExit: (callback) => {
		const listener = (_event, sessionId, exitCode) => callback(sessionId, exitCode);
		electron.ipcRenderer.on("pty-exit", listener);
		return () => electron.ipcRenderer.removeListener("pty-exit", listener);
	},
	onSessionTitleUpdated: (callback) => {
		const listener = (_event, sessionId, title) => callback(sessionId, title);
		electron.ipcRenderer.on("session-title-updated", listener);
		return () => electron.ipcRenderer.removeListener("session-title-updated", listener);
	},
	getProfileMcpServers: (profileId) => electron.ipcRenderer.invoke("getProfileMcpServers", profileId),
	saveProfileMcpServer: (profileId, name, config, previousName) => electron.ipcRenderer.invoke("saveProfileMcpServer", profileId, name, config, previousName),
	deleteProfileMcpServer: (profileId, name) => electron.ipcRenderer.invoke("deleteProfileMcpServer", profileId, name),
	getProfilePluginMarketplaces: (profileId) => electron.ipcRenderer.invoke("getProfilePluginMarketplaces", profileId),
	addProfilePluginMarketplace: (profileId, source) => electron.ipcRenderer.invoke("addProfilePluginMarketplace", profileId, source),
	removeProfilePluginMarketplace: (profileId, name) => electron.ipcRenderer.invoke("removeProfilePluginMarketplace", profileId, name),
	getProfilePlugins: (profileId) => electron.ipcRenderer.invoke("getProfilePlugins", profileId),
	installProfilePlugin: (profileId, spec) => electron.ipcRenderer.invoke("installProfilePlugin", profileId, spec),
	uninstallProfilePlugin: (profileId, spec) => electron.ipcRenderer.invoke("uninstallProfilePlugin", profileId, spec),
	setProfilePluginEnabled: (profileId, spec, enabled) => electron.ipcRenderer.invoke("setProfilePluginEnabled", profileId, spec, enabled),
	getGitDiff: (workspacePath) => electron.ipcRenderer.invoke("getGitDiff", workspacePath),
	getGitBranches: (workspacePath) => electron.ipcRenderer.invoke("getGitBranches", workspacePath),
	checkoutGitBranch: (workspacePath, branchName) => electron.ipcRenderer.invoke("checkoutGitBranch", workspacePath, branchName),
	createGitBranch: (workspacePath, branchName) => electron.ipcRenderer.invoke("createGitBranch", workspacePath, branchName),
	gitCommit: (workspacePath, message, filePaths) => electron.ipcRenderer.invoke("gitCommit", workspacePath, message, filePaths),
	gitPush: (workspacePath) => electron.ipcRenderer.invoke("gitPush", workspacePath),
	exportSession: (sessionId) => electron.ipcRenderer.invoke("exportSession", sessionId),
	exportSessionSummary: (sessionId) => electron.ipcRenderer.invoke("exportSessionSummary", sessionId),
	selectDirectory: () => electron.ipcRenderer.invoke("selectDirectory"),
	openWorkspaceFolder: (workspacePath) => electron.ipcRenderer.invoke("openWorkspaceFolder", workspacePath),
	startClaudeAuth: (profileName) => electron.ipcRenderer.invoke("startClaudeAuth", profileName),
	verifyClaudeAuth: (profileName) => electron.ipcRenderer.invoke("verifyClaudeAuth", profileName),
	closeWindow: () => electron.ipcRenderer.invoke("closeWindow"),
	minimizeWindow: () => electron.ipcRenderer.invoke("minimizeWindow"),
	maximizeWindow: () => electron.ipcRenderer.invoke("maximizeWindow"),
	getAppVersion: () => electron.ipcRenderer.invoke("getAppVersion")
});
//#endregion
