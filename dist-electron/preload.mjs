let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("api", {
	getProfiles: () => electron.ipcRenderer.invoke("getProfiles"),
	createProfile: (profileData) => electron.ipcRenderer.invoke("createProfile", profileData),
	getSessions: () => electron.ipcRenderer.invoke("getSessions"),
	createSession: (sessionData) => electron.ipcRenderer.invoke("createSession", sessionData),
	startCliSession: (sessionId) => electron.ipcRenderer.invoke("startCliSession", sessionId),
	sendCliInput: (sessionId, input) => electron.ipcRenderer.invoke("sendCliInput", sessionId, input),
	onCliOutput: (callback) => {
		electron.ipcRenderer.on("cli-output", (_event, sessionId, output) => callback(sessionId, output));
	},
	getGitDiff: (workspacePath) => electron.ipcRenderer.invoke("getGitDiff", workspacePath),
	exportSession: (sessionId) => electron.ipcRenderer.invoke("exportSession", sessionId),
	closeWindow: () => electron.ipcRenderer.invoke("closeWindow"),
	minimizeWindow: () => electron.ipcRenderer.invoke("minimizeWindow"),
	maximizeWindow: () => electron.ipcRenderer.invoke("maximizeWindow")
});
//#endregion
