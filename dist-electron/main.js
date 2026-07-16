//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let path = require("path");
path = __toESM(path);
let fs = require("fs");
fs = __toESM(fs);
let child_process = require("child_process");
let util = require("util");
let crypto = require("crypto");
let os = require("os");
os = __toESM(os);
//#region electron/db.ts
var db;
var DB_FILENAME = "claudedesk.sqlite";
/** Older Electron userData folders we may have used before the app was renamed. */
function legacyDbCandidates(currentDbPath) {
	const appData = electron.app.getPath("appData");
	return [
		path.default.join(appData, "agent-app", DB_FILENAME),
		path.default.join(appData, "claudedeck", DB_FILENAME),
		path.default.join(appData, "ClaudeDeck", DB_FILENAME)
	].filter((p) => path.default.resolve(p) !== path.default.resolve(currentDbPath));
}
function sqliteProfileCount(dbPath) {
	try {
		const req = eval("require");
		const Database = req("better-sqlite3");
		const probe = new Database(dbPath, {
			readonly: true,
			fileMustExist: true
		});
		try {
			return probe.prepare("SELECT COUNT(*) as n FROM profiles").get()?.n ?? 0;
		} finally {
			probe.close();
		}
	} catch {
		return 0;
	}
}
/**
* If the current userData DB is missing/empty but a legacy install still has
* profiles (e.g. after renaming the app moved Electron's userData path), copy
* that database over before we open it for real.
*/
function migrateLegacyDatabaseIfNeeded(currentDbPath) {
	const currentExists = fs.default.existsSync(currentDbPath);
	if ((currentExists ? sqliteProfileCount(currentDbPath) : 0) > 0) return;
	for (const legacyPath of legacyDbCandidates(currentDbPath)) {
		if (!fs.default.existsSync(legacyPath)) continue;
		const legacyCount = sqliteProfileCount(legacyPath);
		if (legacyCount <= 0) continue;
		fs.default.mkdirSync(path.default.dirname(currentDbPath), { recursive: true });
		if (currentExists) {
			const backup = `${currentDbPath}.pre-migrate-${Date.now()}.bak`;
			fs.default.copyFileSync(currentDbPath, backup);
			console.log("[DB] Backed up empty/current DB to", backup);
		}
		fs.default.copyFileSync(legacyPath, currentDbPath);
		for (const suffix of ["-wal", "-shm"]) {
			const src = legacyPath + suffix;
			const dest = currentDbPath + suffix;
			if (fs.default.existsSync(src)) fs.default.copyFileSync(src, dest);
			else if (fs.default.existsSync(dest)) fs.default.unlinkSync(dest);
		}
		console.log(`[DB] Migrated ${legacyCount} profile(s) from legacy path:`, legacyPath);
		return;
	}
}
function initDb() {
	const req = eval("require");
	const Database = req("better-sqlite3");
	const dbPath = path.default.join(electron.app.getPath("userData"), DB_FILENAME);
	migrateLegacyDatabaseIfNeeded(dbPath);
	db = new Database(dbPath);
	db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      keytar_service_key TEXT,
      claude_config_dir TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      model TEXT NOT NULL,
      permission_mode TEXT DEFAULT 'default',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_configs (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      claude_md_content TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS terminal_snapshots (
      session_id TEXT PRIMARY KEY,
      buffer TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
	try {
		const columns = db.prepare("PRAGMA table_info(profiles)").all();
		const hasAlias = columns.some((col) => col.name === "alias");
		const hasName = columns.some((col) => col.name === "name");
		if (hasAlias && !hasName) {
			db.exec(`
        CREATE TABLE profiles_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          auth_type TEXT NOT NULL,
          keytar_service_key TEXT,
          claude_config_dir TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO profiles_new (id, name, auth_type, keytar_service_key, claude_config_dir, created_at)
        SELECT id, alias, auth_type, keytar_service_key, claude_config_dir, created_at FROM profiles;

        DROP TABLE profiles;

        ALTER TABLE profiles_new RENAME TO profiles;
      `);
			console.log("Database migration: Renamed alias column to name");
		}
	} catch (e) {
		console.error("Migration error (likely no existing data):", e);
	}
	try {
		if (!db.prepare("PRAGMA table_info(sessions)").all().some((col) => col.name === "permission_mode")) {
			db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT DEFAULT 'default'`);
			console.log("Database migration: Added permission_mode column to sessions");
		}
	} catch (e) {
		console.error("Migration error (permission_mode):", e);
	}
	try {
		if (!db.prepare("PRAGMA table_info(sessions)").all().some((col) => col.name === "claude_bound")) {
			db.exec(`ALTER TABLE sessions ADD COLUMN claude_bound INTEGER DEFAULT 0`);
			console.log("Database migration: Added claude_bound column to sessions");
		}
	} catch (e) {
		console.error("Migration error (claude_bound):", e);
	}
	try {
		if (!db.prepare("PRAGMA table_info(sessions)").all().some((col) => col.name === "title")) {
			db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
			console.log("Database migration: Added title column to sessions");
		}
	} catch (e) {
		console.error("Migration error (title):", e);
	}
	try {
		if (!db.prepare("PRAGMA table_info(sessions)").all().some((col) => col.name === "color")) {
			db.exec(`ALTER TABLE sessions ADD COLUMN color TEXT`);
			const palette = [
				"#D4A843",
				"#4CAF7D",
				"#5B8DEF",
				"#B583D8",
				"#5BC6D8",
				"#E05C5C",
				"#E08A4D",
				"#3DB8A0"
			];
			const rows = db.prepare("SELECT id FROM sessions ORDER BY started_at ASC").all();
			const update = db.prepare("UPDATE sessions SET color = ? WHERE id = ?");
			rows.forEach((row, i) => update.run(palette[i % palette.length], row.id));
			console.log("Database migration: Added color column to sessions");
		}
	} catch (e) {
		console.error("Migration error (color):", e);
	}
}
function getDb() {
	if (!db) throw new Error("DB not initialized");
	return db;
}
//#endregion
//#region electron/profileConfig.ts
var profileConfig_exports = /* @__PURE__ */ __exportAll({
	addPluginMarketplace: () => addPluginMarketplace,
	deleteMcpServer: () => deleteMcpServer,
	installPlugin: () => installPlugin,
	listMcpServers: () => listMcpServers,
	listPluginMarketplaces: () => listPluginMarketplaces,
	listPlugins: () => listPlugins,
	removePluginMarketplace: () => removePluginMarketplace,
	resolveConfigDir: () => resolveConfigDir,
	saveMcpServer: () => saveMcpServer,
	setPluginEnabled: () => setPluginEnabled,
	uninstallPlugin: () => uninstallPlugin
});
function resolveConfigDir(profile) {
	return (profile?.claude_config_dir || "~/.claude-profiles/default").replace("~", os.default.homedir());
}
function readJsonFile(filePath) {
	try {
		if (!fs.default.existsSync(filePath)) return {};
		const raw = fs.default.readFileSync(filePath, "utf8");
		return raw.trim() ? JSON.parse(raw) : {};
	} catch (e) {
		console.error("[ProfileConfig] Failed to read", filePath, e);
		return {};
	}
}
function writeJsonFile(filePath, data) {
	fs.default.mkdirSync(path.default.dirname(filePath), { recursive: true });
	fs.default.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}
function claudeJsonPath(profile) {
	return path.default.join(resolveConfigDir(profile), ".claude.json");
}
function settingsJsonPath(profile) {
	return path.default.join(resolveConfigDir(profile), "settings.json");
}
function listMcpServers(profile) {
	const servers = readJsonFile(claudeJsonPath(profile)).mcpServers || {};
	return Object.entries(servers).map(([name, cfg]) => ({
		name,
		type: cfg.type || (cfg.url ? "http" : "stdio"),
		...cfg
	}));
}
function saveMcpServer(profile, name, config, previousName) {
	try {
		const filePath = claudeJsonPath(profile);
		const data = readJsonFile(filePath);
		if (!data.mcpServers) data.mcpServers = {};
		if (previousName && previousName !== name) delete data.mcpServers[previousName];
		data.mcpServers[name] = config;
		writeJsonFile(filePath, data);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			message: e.message || "Failed to save MCP server"
		};
	}
}
function deleteMcpServer(profile, name) {
	try {
		const filePath = claudeJsonPath(profile);
		const data = readJsonFile(filePath);
		if (data.mcpServers) delete data.mcpServers[name];
		writeJsonFile(filePath, data);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			message: e.message || "Failed to delete MCP server"
		};
	}
}
function runClaudeCli(env, args, timeoutMs = 6e4) {
	return new Promise((resolve) => {
		const child = (0, child_process.spawn)("npx", ["claude", ...args], {
			cwd: os.default.homedir(),
			env
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			resolve({
				success: false,
				stdout,
				message: "Command timed out"
			});
		}, timeoutMs);
		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				success: false,
				stdout,
				message: err.message
			});
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code === 0) resolve({
				success: true,
				stdout
			});
			else resolve({
				success: false,
				stdout,
				message: stderr.trim() || stdout.trim() || `claude exited with code ${code}`
			});
		});
	});
}
function parseJsonList(stdout, wrapperKeys) {
	const parsed = JSON.parse(stdout);
	if (Array.isArray(parsed)) return parsed;
	for (const key of wrapperKeys) if (Array.isArray(parsed?.[key])) return parsed[key];
	return [];
}
async function listPluginMarketplaces(env) {
	const res = await runClaudeCli(env, [
		"plugin",
		"marketplace",
		"list",
		"--json"
	], 3e4);
	if (!res.success) return {
		marketplaces: [],
		error: res.message
	};
	try {
		return { marketplaces: parseJsonList(res.stdout, ["marketplaces"]) };
	} catch (e) {
		return {
			marketplaces: [],
			error: "Could not parse marketplace list",
			raw: res.stdout
		};
	}
}
async function addPluginMarketplace(env, source) {
	const res = await runClaudeCli(env, [
		"plugin",
		"marketplace",
		"add",
		source,
		"--scope",
		"user"
	], 12e4);
	return {
		success: res.success,
		message: res.message || (res.success ? `Added marketplace "${source}"` : void 0)
	};
}
async function removePluginMarketplace(env, name) {
	const res = await runClaudeCli(env, [
		"plugin",
		"marketplace",
		"remove",
		name,
		"--scope",
		"user"
	], 3e4);
	return {
		success: res.success,
		message: res.message || (res.success ? `Removed marketplace "${name}"` : void 0)
	};
}
async function listPlugins(env) {
	const res = await runClaudeCli(env, [
		"plugin",
		"list",
		"--json"
	], 3e4);
	if (!res.success) return {
		plugins: [],
		error: res.message
	};
	try {
		return { plugins: parseJsonList(res.stdout, ["installed", "plugins"]) };
	} catch (e) {
		return {
			plugins: [],
			error: "Could not parse plugin list",
			raw: res.stdout
		};
	}
}
async function installPlugin(env, spec) {
	const res = await runClaudeCli(env, [
		"plugin",
		"install",
		spec,
		"--scope",
		"user"
	], 12e4);
	return {
		success: res.success,
		message: res.message || (res.success ? `Installed "${spec}"` : void 0)
	};
}
async function uninstallPlugin(env, spec) {
	const res = await runClaudeCli(env, [
		"plugin",
		"uninstall",
		spec,
		"--scope",
		"user"
	], 3e4);
	return {
		success: res.success,
		message: res.message || (res.success ? `Uninstalled "${spec}"` : void 0)
	};
}
function setPluginEnabled(profile, spec, enabled) {
	try {
		const filePath = settingsJsonPath(profile);
		const data = readJsonFile(filePath);
		if (!data.enabledPlugins) data.enabledPlugins = {};
		data.enabledPlugins[spec] = enabled;
		writeJsonFile(filePath, data);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			message: e.message || "Failed to update plugin state"
		};
	}
}
//#endregion
//#region electron/main.ts
Object.assign(global, {
	__filename,
	__dirname
});
electron.app.setName("ClaudeDesk");
electron.app.setPath("userData", path.default.join(electron.app.getPath("appData"), "ClaudeDesk"));
var execFileAsync = (0, util.promisify)(child_process.execFile);
async function runGit(args, cwd, timeoutMs = 6e4) {
	if (!cwd || typeof cwd !== "string") return {
		ok: false,
		stdout: "",
		stderr: "",
		message: "Invalid workspace path"
	};
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd,
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: 10 * 1024 * 1024,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GC_TRACE: void 0
			}
		});
		const out = (stdout || "").toString();
		const err = (stderr || "").toString();
		return {
			ok: true,
			stdout: out,
			stderr: err,
			message: out.trim() || err.trim() || "OK"
		};
	} catch (e) {
		const killed = e?.killed || e?.signal === "SIGTERM";
		const stdout = (e?.stdout ?? "").toString();
		const stderr = (e?.stderr ?? "").toString();
		const fallback = e?.message ? String(e.message) : "Git command failed";
		const detail = (stderr.trim() || stdout.trim() || fallback).trim();
		return {
			ok: false,
			stdout,
			stderr,
			message: killed ? `Git timed out after ${Math.round(timeoutMs / 1e3)}s — ${detail}` : detail
		};
	}
}
function firstLine(text) {
	return text.split("\n").map((l) => l.trim()).find(Boolean) || text.trim();
}
var mainWindow = null;
var isQuitting = false;
process.on("uncaughtException", (err) => {
	if (isQuitting && /Object has been destroyed/i.test(err?.message || "")) {
		console.warn("[Shutdown] Ignored post-quit error:", err.message);
		return;
	}
	console.error("[Uncaught Exception]", err);
});
function safeSend(channel, ...args) {
	try {
		if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, ...args);
	} catch (e) {}
}
var activeCliSessions = {};
var MAX_BUFFER_CHARS = 5e5;
function persistBuffer(sessionId) {
	const active = activeCliSessions[sessionId];
	if (!active) return;
	try {
		getDb().prepare(`
      INSERT INTO terminal_snapshots (session_id, buffer, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET buffer = excluded.buffer, updated_at = CURRENT_TIMESTAMP
    `).run(sessionId, active.buffer);
	} catch (e) {
		console.error("[PTY] Failed to persist buffer for", sessionId, e);
	}
	maybeGenerateSessionTitle(sessionId);
}
var TITLE_MIN_TRANSCRIPT_CHARS = 400;
var titleGenerationInFlight = /* @__PURE__ */ new Set();
var titleNextAttemptAt = /* @__PURE__ */ new Map();
function stripAnsi(text) {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
async function maybeGenerateSessionTitle(sessionId) {
	if (titleGenerationInFlight.has(sessionId)) return;
	if ((titleNextAttemptAt.get(sessionId) || 0) > Date.now()) return;
	const db = getDb();
	const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
	if (!session || session.title) return;
	const plain = stripAnsi(activeCliSessions[sessionId]?.buffer || db.prepare("SELECT buffer FROM terminal_snapshots WHERE session_id = ?").get(sessionId)?.buffer || "").trim();
	if (plain.length < TITLE_MIN_TRANSCRIPT_CHARS) return;
	const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(session.profile_id);
	if (!profile) return;
	titleGenerationInFlight.add(sessionId);
	try {
		const cleaned = (await runClaudePrint([
			"Write a very short session title (3-7 words) summarizing what this Claude Code conversation is about.",
			"Match the style of titles like \"TDD analysis for experiments-api\" or \"Database to Snowflake data flow\".",
			"Output ONLY the title — no quotes, no trailing punctuation, no explanation.",
			"",
			"Transcript:",
			plain.slice(-8e3)
		].join("\n"), session.model, session.workspace_path, buildClaudeEnv(profile))).split("\n").map((l) => l.trim()).find((l) => l.length > 0)?.replace(/^["'`]+|["'`]+$/g, "").replace(/[.!?]+$/g, "").trim().slice(0, 80);
		if (!cleaned) {
			titleNextAttemptAt.set(sessionId, Date.now() + 12e4);
			return;
		}
		db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(cleaned, sessionId);
		console.log("[Title] Generated for", sessionId, "→", cleaned);
		safeSend("session-title-updated", sessionId, cleaned);
	} catch (e) {
		console.error("[Title] Failed to generate for", sessionId, e);
		titleNextAttemptAt.set(sessionId, Date.now() + 12e4);
	} finally {
		titleGenerationInFlight.delete(sessionId);
	}
}
var ptyModule = null;
function getPty() {
	if (!ptyModule) {
		const req = eval("require");
		ptyModule = req("node-pty");
	}
	return ptyModule;
}
function buildClaudeEnv(profile) {
	const env = {
		...process.env,
		FORCE_COLOR: "1"
	};
	if (profile.claude_config_dir) {
		const homedir = require("os").homedir();
		env.CLAUDE_CONFIG_DIR = profile.claude_config_dir.replace("~", homedir);
	}
	if (profile.auth_type === "apikey" && profile.keytar_service_key && electron.safeStorage.isEncryptionAvailable()) env.ANTHROPIC_API_KEY = electron.safeStorage.decryptString(Buffer.from(profile.keytar_service_key, "base64"));
	return env;
}
function buildClaudeArgs(session, opts) {
	const args = [
		"claude",
		"--model",
		session.model
	];
	if (opts.resume) args.push("--resume", session.id);
	else if (opts.continueRecent) args.push("--continue");
	else args.push("--session-id", session.id);
	const mode = session.permission_mode || "default";
	if (mode === "bypassPermissions") args.push("--dangerously-skip-permissions");
	else if (mode && mode !== "default") args.push("--permission-mode", mode);
	return args;
}
function runClaudePrint(prompt, model, cwd, env) {
	return new Promise((resolve, reject) => {
		const child = (0, child_process.spawn)("npx", [
			"claude",
			"-p",
			"--model",
			model,
			"--tools",
			"",
			"--no-session-persistence"
		], {
			cwd,
			env
		});
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill();
			reject(/* @__PURE__ */ new Error("Timed out waiting for Claude to generate the summary"));
		}, 9e4);
		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			if (code === 0 && stdout.trim()) resolve(stdout.trim());
			else reject(new Error(stderr.trim() || "Claude CLI exited without producing a summary"));
		});
		child.stdin.write(prompt);
		child.stdin.end();
	});
}
function spawnClaudePty(sessionId, cols = 80, rows = 30) {
	const db = getDb();
	const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
	if (!session) return {
		success: false,
		message: "Session not found"
	};
	const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(session.profile_id);
	if (!profile) return {
		success: false,
		message: "Profile not found"
	};
	const priorBuffer = db.prepare("SELECT buffer FROM terminal_snapshots WHERE session_id = ?").get(sessionId)?.buffer || "";
	const hasPriorTranscript = priorBuffer.length > 0;
	const canResumeById = !!session.claude_bound;
	const env = buildClaudeEnv(profile);
	const args = buildClaudeArgs(session, {
		resume: hasPriorTranscript && canResumeById,
		continueRecent: hasPriorTranscript && !canResumeById
	});
	console.log("[PTY] Spawning claude for session", sessionId, "| args:", args, "| cwd:", session.workspace_path);
	const ptyProcess = getPty().spawn("npx", args, {
		name: "xterm-256color",
		cols,
		rows,
		cwd: session.workspace_path,
		env
	});
	ptyProcess.onData((data) => {
		const active = activeCliSessions[sessionId];
		if (active) {
			active.buffer += data;
			if (active.buffer.length > MAX_BUFFER_CHARS) active.buffer = active.buffer.slice(active.buffer.length - MAX_BUFFER_CHARS);
		}
		safeSend("pty-output", sessionId, data);
	});
	ptyProcess.onExit(({ exitCode }) => {
		console.log("[PTY] Session", sessionId, "process exited with code", exitCode);
		persistBuffer(sessionId);
		if (activeCliSessions[sessionId]) clearInterval(activeCliSessions[sessionId].saveTimer);
		delete activeCliSessions[sessionId];
		safeSend("pty-exit", sessionId, exitCode);
	});
	activeCliSessions[sessionId] = {
		pty: ptyProcess,
		session,
		buffer: priorBuffer,
		saveTimer: setInterval(() => persistBuffer(sessionId), 3e3)
	};
	if (!hasPriorTranscript && !session.claude_bound) try {
		db.prepare("UPDATE sessions SET claude_bound = 1 WHERE id = ?").run(sessionId);
		session.claude_bound = 1;
	} catch (e) {
		console.error("[PTY] Failed to mark session as claude_bound", sessionId, e);
	}
	return { success: true };
}
function killClaudePty(sessionId) {
	const active = activeCliSessions[sessionId];
	if (active) {
		clearInterval(active.saveTimer);
		persistBuffer(sessionId);
		if (active.pty) try {
			active.pty.kill();
		} catch (e) {
			console.error("[PTY] Error killing process for session", sessionId, e);
		}
		delete activeCliSessions[sessionId];
	}
}
function resolveAppIcon() {
	const root = path.default.join(__dirname, "..");
	const candidates = [
		path.default.join(root, "build", "icon-512.png"),
		path.default.join(root, "build", "icon.png"),
		path.default.join(root, "build", "icon-dock.png")
	];
	for (const candidate of candidates) if (fs.default.existsSync(candidate)) return candidate;
	return "";
}
function createWindow() {
	const icon = resolveAppIcon();
	mainWindow = new electron.BrowserWindow({
		width: 1200,
		height: 800,
		frame: false,
		titleBarStyle: "hiddenInset",
		title: "ClaudeDesk",
		...icon ? { icon } : {},
		webPreferences: {
			preload: path.default.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	mainWindow.setTitle("ClaudeDesk");
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.default.join(__dirname, "../dist/index.html"));
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}
electron.app.whenReady().then(() => {
	if (process.platform === "darwin" && electron.app.dock) try {
		electron.app.dock.setIcon(resolveAppIcon());
	} catch (e) {
		console.warn("[App] Could not set dock icon:", e);
	}
	initDb();
	setupIpcHandlers();
	createWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	isQuitting = true;
	for (const sessionId of Object.keys(activeCliSessions)) killClaudePty(sessionId);
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
	isQuitting = true;
	for (const sessionId of Object.keys(activeCliSessions)) killClaudePty(sessionId);
});
function setupIpcHandlers() {
	electron.ipcMain.handle("getProfiles", () => {
		return getDb().prepare("SELECT id, name, auth_type, created_at FROM profiles").all();
	});
	electron.ipcMain.handle("createProfile", (_event, profileData) => {
		const db = getDb();
		const id = (0, crypto.randomUUID)();
		let encryptedKey = null;
		if (profileData.apiKey && electron.safeStorage.isEncryptionAvailable()) encryptedKey = electron.safeStorage.encryptString(profileData.apiKey).toString("base64");
		db.prepare(`
      INSERT INTO profiles (id, name, auth_type, keytar_service_key, claude_config_dir)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, profileData.name, profileData.authType, encryptedKey, `~/.claude-profiles/${profileData.name}`);
		return id;
	});
	electron.ipcMain.handle("deleteProfile", (_event, profileId) => {
		console.log("[Delete Profile Backend] Starting deletion for profileId:", profileId);
		const db = getDb();
		const fs$4 = require("fs");
		const homedir = require("os").homedir();
		try {
			console.log("[Delete Profile Backend] Fetching profile from database...");
			const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
			console.log("[Delete Profile Backend] Profile data:", profile);
			if (!profile) {
				console.error("[Delete Profile Backend] Profile not found in database");
				return {
					success: false,
					message: "Profile not found"
				};
			}
			console.log("[Delete Profile Backend] Checking for active sessions...");
			const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE profile_id = ?").get(profileId);
			console.log("[Delete Profile Backend] Active sessions count:", activeSessions.count);
			if (activeSessions.count > 0) {
				console.error("[Delete Profile Backend] Profile has active sessions, cannot delete");
				return {
					success: false,
					message: "Cannot delete profile with active sessions. Please delete sessions first."
				};
			}
			if (profile.claude_config_dir) {
				const configDir = profile.claude_config_dir.replace("~", homedir);
				console.log("[Delete Profile Backend] Checking config directory:", configDir);
				if (fs$4.existsSync(configDir)) {
					console.log("[Delete Profile Backend] Config directory exists, removing...");
					fs$4.rmSync(configDir, {
						recursive: true,
						force: true
					});
					console.log("[Delete Profile Backend] Config directory removed successfully");
				} else console.log("[Delete Profile Backend] Config directory does not exist, skipping");
			} else console.log("[Delete Profile Backend] No config directory specified");
			console.log("[Delete Profile Backend] Deleting from database...");
			const deleteResult = db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
			console.log("[Delete Profile Backend] Database deletion result:", deleteResult);
			console.log("[Delete Profile Backend] Profile deleted successfully");
			return {
				success: true,
				message: "Profile deleted successfully"
			};
		} catch (error) {
			console.error("[Delete Profile Backend] Exception occurred:", error);
			console.error("[Delete Profile Backend] Error stack:", error.stack);
			return {
				success: false,
				message: error.message || "Failed to delete profile"
			};
		}
	});
	electron.ipcMain.handle("getProfileMcpServers", (_event, profileId) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			servers: [],
			error: "Profile not found"
		};
		return { servers: listMcpServers(profile) };
	});
	electron.ipcMain.handle("saveProfileMcpServer", (_event, profileId, name, config, previousName) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return saveMcpServer(profile, name, config, previousName);
	});
	electron.ipcMain.handle("deleteProfileMcpServer", (_event, profileId, name) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return deleteMcpServer(profile, name);
	});
	electron.ipcMain.handle("getProfilePluginMarketplaces", async (_event, profileId) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			marketplaces: [],
			error: "Profile not found"
		};
		return listPluginMarketplaces(buildClaudeEnv(profile));
	});
	electron.ipcMain.handle("addProfilePluginMarketplace", async (_event, profileId, source) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return addPluginMarketplace(buildClaudeEnv(profile), source);
	});
	electron.ipcMain.handle("removeProfilePluginMarketplace", async (_event, profileId, name) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return removePluginMarketplace(buildClaudeEnv(profile), name);
	});
	electron.ipcMain.handle("getProfilePlugins", async (_event, profileId) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			plugins: [],
			error: "Profile not found"
		};
		return listPlugins(buildClaudeEnv(profile));
	});
	electron.ipcMain.handle("installProfilePlugin", async (_event, profileId, spec) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return installPlugin(buildClaudeEnv(profile), spec);
	});
	electron.ipcMain.handle("uninstallProfilePlugin", async (_event, profileId, spec) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return uninstallPlugin(buildClaudeEnv(profile), spec);
	});
	electron.ipcMain.handle("setProfilePluginEnabled", (_event, profileId, spec, enabled) => {
		const profile = getDb().prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		return setPluginEnabled(profile, spec, enabled);
	});
	electron.ipcMain.handle("getSessions", () => {
		return getDb().prepare("SELECT * FROM sessions").all();
	});
	electron.ipcMain.handle("getRecentWorkspaces", () => {
		return getDb().prepare(`
      SELECT workspace_path, MAX(started_at) as last_used
      FROM sessions
      GROUP BY workspace_path
      ORDER BY last_used DESC
      LIMIT 5
    `).all().map((r) => r.workspace_path);
	});
	electron.ipcMain.handle("createSession", (_event, sessionData) => {
		const db = getDb();
		const id = (0, crypto.randomUUID)();
		const palette = [
			"#D4A843",
			"#4CAF7D",
			"#5B8DEF",
			"#B583D8",
			"#5BC6D8",
			"#E05C5C",
			"#E08A4D",
			"#3DB8A0"
		];
		const existing = db.prepare("SELECT color FROM sessions").all();
		const counts = new Map(palette.map((c) => [c, 0]));
		for (const row of existing) if (row.color && counts.has(row.color)) counts.set(row.color, (counts.get(row.color) || 0) + 1);
		let color = palette[0];
		let best = Infinity;
		for (const c of palette) {
			const n = counts.get(c) || 0;
			if (n < best) {
				color = c;
				best = n;
			}
		}
		db.prepare(`
      INSERT INTO sessions (id, profile_id, workspace_path, model, permission_mode, status, color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionData.profileId, sessionData.workspacePath, sessionData.model, sessionData.permissionMode || "default", "active", color);
		return id;
	});
	electron.ipcMain.handle("updateSessionMode", (_event, sessionId, permissionMode) => {
		const db = getDb();
		try {
			db.prepare("UPDATE sessions SET permission_mode = ? WHERE id = ?").run(permissionMode, sessionId);
			return { success: true };
		} catch (error) {
			console.error("[Update Session Mode] Error:", error);
			return {
				success: false,
				message: error.message
			};
		}
	});
	electron.ipcMain.handle("updateSessionColor", (_event, sessionId, color) => {
		const db = getDb();
		try {
			if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) return {
				success: false,
				message: "Invalid color"
			};
			db.prepare("UPDATE sessions SET color = ? WHERE id = ?").run(color, sessionId);
			return { success: true };
		} catch (error) {
			console.error("[Update Session Color] Error:", error);
			return {
				success: false,
				message: error.message
			};
		}
	});
	electron.ipcMain.handle("restartCliSession", (_event, sessionId, cols, rows) => {
		killClaudePty(sessionId);
		return spawnClaudePty(sessionId, cols, rows);
	});
	electron.ipcMain.handle("deleteSession", (_event, sessionId) => {
		console.log("[Delete Session] Starting deletion for sessionId:", sessionId);
		const db = getDb();
		try {
			console.log("[Delete Session] Fetching session from database...");
			const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
			console.log("[Delete Session] Session data:", session);
			if (!session) {
				console.error("[Delete Session] Session not found in database");
				return {
					success: false,
					message: "Session not found"
				};
			}
			console.log("[Delete Session] Cleaning up active PTY process");
			killClaudePty(sessionId);
			console.log("[Delete Session] Deleting associated messages...");
			const messagesResult = db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
			console.log("[Delete Session] Deleted messages:", messagesResult.changes);
			db.prepare("DELETE FROM terminal_snapshots WHERE session_id = ?").run(sessionId);
			console.log("[Delete Session] Deleting session from database...");
			const sessionResult = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
			console.log("[Delete Session] Database deletion result:", sessionResult);
			console.log("[Delete Session] Session deleted successfully");
			return {
				success: true,
				message: "Session closed successfully"
			};
		} catch (error) {
			console.error("[Delete Session] Exception occurred:", error);
			console.error("[Delete Session] Error stack:", error.stack);
			return {
				success: false,
				message: error.message || "Failed to delete session"
			};
		}
	});
	electron.ipcMain.handle("getMessages", (_event, sessionId) => {
		return getDb().prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC").all(sessionId);
	});
	electron.ipcMain.handle("saveMessage", (_event, message) => {
		const db = getDb();
		const id = (0, crypto.randomUUID)();
		db.prepare(`
      INSERT INTO messages (id, session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, message.session_id, message.role, message.content, message.timestamp);
		return id;
	});
	electron.ipcMain.handle("startCliSession", (_event, sessionId, cols, rows) => {
		if (activeCliSessions[sessionId]?.pty) return {
			success: true,
			alreadyRunning: true
		};
		return spawnClaudePty(sessionId, cols, rows);
	});
	electron.ipcMain.handle("sendCliInput", (_event, sessionId, data) => {
		const active = activeCliSessions[sessionId];
		if (!active?.pty) {
			console.error("[PTY Input] No active PTY for session:", sessionId);
			return false;
		}
		active.pty.write(data);
		return true;
	});
	electron.ipcMain.handle("resizeCliSession", (_event, sessionId, cols, rows) => {
		const active = activeCliSessions[sessionId];
		if (active?.pty) try {
			active.pty.resize(cols, rows);
		} catch (e) {
			console.error("[PTY Resize] Error:", e);
		}
		return true;
	});
	electron.ipcMain.handle("getTerminalSnapshot", (_event, sessionId) => {
		const active = activeCliSessions[sessionId];
		if (active) return active.buffer;
		const row = getDb().prepare("SELECT buffer FROM terminal_snapshots WHERE session_id = ?").get(sessionId);
		return row ? row.buffer : null;
	});
	electron.ipcMain.handle("getGitDiff", async (_event, workspacePath) => {
		try {
			const diffRes = await runGit(["diff"], workspacePath, 3e4);
			if (!diffRes.ok && /not a git repository/i.test(diffRes.message)) return { error: "Not a git repository or git error" };
			const statusRes = await runGit(["status", "-s"], workspacePath, 15e3);
			const branchRes = await runGit([
				"rev-parse",
				"--abbrev-ref",
				"HEAD"
			], workspacePath, 1e4);
			return {
				diff: diffRes.ok ? diffRes.stdout : "",
				status: statusRes.ok ? statusRes.stdout : "",
				branch: branchRes.ok ? branchRes.stdout.trim() : "",
				...diffRes.ok ? {} : { error: firstLine(diffRes.message) || "Git error" }
			};
		} catch (e) {
			console.error("[getGitDiff]", e);
			return { error: e?.message || "Not a git repository or git error" };
		}
	});
	electron.ipcMain.handle("getGitBranches", async (_event, workspacePath) => {
		try {
			const listRes = await runGit(["branch", "--format=%(refname:short)"], workspacePath, 15e3);
			if (!listRes.ok) return {
				branches: [],
				current: "",
				error: firstLine(listRes.message) || "Not a git repository or git error"
			};
			const branches = listRes.stdout.split("\n").map((b) => b.trim()).filter(Boolean);
			const currentRes = await runGit([
				"rev-parse",
				"--abbrev-ref",
				"HEAD"
			], workspacePath, 1e4);
			return {
				branches,
				current: currentRes.ok ? currentRes.stdout.trim() : ""
			};
		} catch (e) {
			console.error("[getGitBranches]", e);
			return {
				branches: [],
				current: "",
				error: e?.message || "Not a git repository or git error"
			};
		}
	});
	electron.ipcMain.handle("checkoutGitBranch", async (_event, workspacePath, branchName) => {
		try {
			if (!branchName || typeof branchName !== "string") return {
				success: false,
				message: "Branch name is required"
			};
			const res = await runGit(["checkout", branchName], workspacePath, 3e4);
			return {
				success: res.ok,
				message: res.ok ? `Switched to "${branchName}"` : firstLine(res.message) || "Failed to switch branch"
			};
		} catch (e) {
			console.error("[checkoutGitBranch]", e);
			return {
				success: false,
				message: e?.message || "Failed to switch branch"
			};
		}
	});
	electron.ipcMain.handle("createGitBranch", async (_event, workspacePath, branchName) => {
		try {
			if (!branchName || typeof branchName !== "string") return {
				success: false,
				message: "Branch name is required"
			};
			const res = await runGit([
				"checkout",
				"-b",
				branchName
			], workspacePath, 3e4);
			return {
				success: res.ok,
				message: res.ok ? `Created and switched to "${branchName}"` : firstLine(res.message) || "Failed to create branch"
			};
		} catch (e) {
			console.error("[createGitBranch]", e);
			return {
				success: false,
				message: e?.message || "Failed to create branch"
			};
		}
	});
	electron.ipcMain.handle("gitCommit", async (_event, workspacePath, message, filePaths) => {
		try {
			if (!message || !String(message).trim()) return {
				success: false,
				message: "Commit message cannot be empty"
			};
			const addRes = await runGit(Array.isArray(filePaths) && filePaths.length > 0 ? [
				"add",
				"--",
				...filePaths.map(String)
			] : ["add", "-A"], workspacePath, 3e4);
			if (!addRes.ok) return {
				success: false,
				message: firstLine(addRes.message) || "Failed to stage files"
			};
			const commitRes = await runGit([
				"commit",
				"-m",
				String(message)
			], workspacePath, 3e4);
			if (!commitRes.ok) return {
				success: false,
				message: firstLine(commitRes.message) || "Commit failed"
			};
			return {
				success: true,
				message: firstLine(commitRes.stdout) || "Committed successfully"
			};
		} catch (e) {
			console.error("[gitCommit]", e);
			return {
				success: false,
				message: e?.message || "Commit failed"
			};
		}
	});
	electron.ipcMain.handle("gitPush", async (_event, workspacePath) => {
		try {
			const branchRes = await runGit([
				"rev-parse",
				"--abbrev-ref",
				"HEAD"
			], workspacePath, 1e4);
			const branch = branchRes.ok ? branchRes.stdout.trim() : "";
			const pushRes = await runGit(["push"], workspacePath, 12e4);
			if (pushRes.ok) return {
				success: true,
				message: firstLine(pushRes.message) || "Pushed successfully"
			};
			if (branch && /set-upstream|no upstream|has no upstream branch/i.test(pushRes.message)) {
				const upstreamRes = await runGit([
					"push",
					"-u",
					"origin",
					branch
				], workspacePath, 12e4);
				return {
					success: upstreamRes.ok,
					message: upstreamRes.ok ? firstLine(upstreamRes.message) || `Pushed and set upstream to origin/${branch}` : firstLine(upstreamRes.message) || "Push failed"
				};
			}
			return {
				success: false,
				message: firstLine(pushRes.message) || "Push failed"
			};
		} catch (e) {
			console.error("[gitPush]", e);
			return {
				success: false,
				message: e?.message || "Push failed"
			};
		}
	});
	electron.ipcMain.handle("exportSession", async (_event, sessionId) => {
		const { dialog } = require("electron");
		const fs$5 = require("fs");
		const db = getDb();
		const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
		if (!session) return false;
		const snapshot = db.prepare("SELECT buffer FROM terminal_snapshots WHERE session_id = ?").get(sessionId);
		const transcript = snapshot?.buffer ? snapshot.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") : "";
		const diffRes = await runGit(["diff"], session.workspace_path, 3e4);
		const diff = diffRes.ok ? diffRes.stdout : "";
		let md = `# ClaudeDesk Session Export\n\n`;
		md += `**Workspace:** \`${session.workspace_path}\`\n`;
		md += `**Model:** ${session.model}\n`;
		md += `**Started At:** ${session.started_at}\n\n`;
		md += `## Terminal Transcript\n\n`;
		md += transcript ? `\`\`\`\n${transcript}\n\`\`\`\n\n` : "_No transcript captured yet._\n\n";
		if (diff) md += `## Git Diff\n\n\`\`\`diff\n${diff}\n\`\`\`\n`;
		const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
			title: "Export Session",
			defaultPath: `session_${sessionId.substring(0, 8)}.md`,
			filters: [{
				name: "Markdown",
				extensions: ["md"]
			}]
		});
		if (!canceled && filePath) {
			fs$5.writeFileSync(filePath, md);
			return true;
		}
		return false;
	});
	electron.ipcMain.handle("exportSessionSummary", async (_event, sessionId) => {
		const { dialog } = require("electron");
		const fs$6 = require("fs");
		const db = getDb();
		const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
		if (!session) return {
			success: false,
			message: "Session not found"
		};
		const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(session.profile_id);
		if (!profile) return {
			success: false,
			message: "Profile not found"
		};
		const snapshot = db.prepare("SELECT buffer FROM terminal_snapshots WHERE session_id = ?").get(sessionId);
		const rawTranscript = snapshot?.buffer ? snapshot.buffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") : "";
		const transcript = rawTranscript.length > 1e5 ? rawTranscript.slice(-1e5) : rawTranscript;
		if (!transcript.trim()) return {
			success: false,
			message: "Nothing to summarize yet — the session has no output."
		};
		const summaryDiffRes = await runGit(["diff"], session.workspace_path, 3e4);
		const diff = summaryDiffRes.ok ? summaryDiffRes.stdout : "";
		const prompt = [
			"You are summarizing a Claude Code terminal session for a developer's changelog.",
			"Below is the raw terminal transcript (ANSI codes already stripped) and the current git diff, if any.",
			"Write a concise Markdown summary (no headings level 1) with:",
			"- A short paragraph describing what was accomplished",
			"- A bullet list of key changes/decisions",
			"- A bullet list of any outstanding issues or follow-ups (omit this section if none)",
			"Do not quote raw logs or diffs verbatim, and do not include any preamble — output only the summary.",
			"",
			"## Transcript",
			transcript,
			diff ? `\n## Git Diff\n${diff}` : ""
		].join("\n");
		try {
			const env = buildClaudeEnv(profile);
			const summary = await runClaudePrint(prompt, session.model, session.workspace_path, env);
			let md = `# Session Summary\n\n`;
			md += `**Workspace:** \`${session.workspace_path}\`\n`;
			md += `**Profile:** ${profile.name}\n`;
			md += `**Model:** ${session.model}\n`;
			md += `**Started At:** ${session.started_at}\n\n`;
			md += summary + "\n";
			const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
				title: "Export Session Summary",
				defaultPath: `session_summary_${sessionId.substring(0, 8)}.md`,
				filters: [{
					name: "Markdown",
					extensions: ["md"]
				}]
			});
			if (!canceled && filePath) {
				fs$6.writeFileSync(filePath, md);
				return { success: true };
			}
			return {
				success: false,
				message: "Export cancelled"
			};
		} catch (e) {
			console.error("[Export Summary] Error:", e);
			return {
				success: false,
				message: e.message || "Failed to generate summary"
			};
		}
	});
	electron.ipcMain.handle("openWorkspaceFolder", (_event, workspacePath) => {
		const { shell } = require("electron");
		shell.openPath(workspacePath);
		return true;
	});
	electron.ipcMain.handle("getAppVersion", () => electron.app.getVersion());
	electron.ipcMain.handle("selectDirectory", async () => {
		const { dialog } = require("electron");
		const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
			title: "Select Workspace Folder",
			properties: ["openDirectory"]
		});
		if (!canceled && filePaths.length > 0) return filePaths[0];
		return null;
	});
	electron.ipcMain.handle("startClaudeAuth", async (_event, profileName) => {
		const { shell } = require("electron");
		const os$2 = require("os");
		const fs$7 = require("fs");
		const homedir = os$2.homedir();
		return new Promise((resolve) => {
			try {
				const configDir = path.default.join(homedir, ".claude-profiles", profileName);
				console.log("[Auth] Creating config directory:", configDir);
				if (!fs$7.existsSync(configDir)) {
					fs$7.mkdirSync(configDir, { recursive: true });
					console.log("[Auth] Config directory created");
				}
				const env = {
					...process.env,
					CLAUDE_CONFIG_DIR: configDir,
					FORCE_COLOR: "0",
					CI: "false"
				};
				console.log("[Auth] Starting Claude authentication...");
				const child = (0, child_process.spawn)("npx", ["claude"], {
					env,
					cwd: homedir
				});
				let output = "";
				let authUrl = "";
				let urlOpened = false;
				const timeout = setTimeout(() => {
					if (!urlOpened) {
						console.log("[Auth] Timeout - no auth URL detected");
						child.kill();
						resolve({
							success: false,
							message: "Could not detect authentication URL. The Claude CLI may already be authenticated or needs manual setup."
						});
					}
				}, 2e4);
				child.stdout.on("data", (data) => {
					const text = data.toString();
					output += text;
					console.log("[Auth] stdout:", text);
					const urls = text.match(/https:\/\/[^\s\)]+/gi);
					if (urls && !urlOpened) {
						for (const url of urls) if (url.includes("anthropic") || url.includes("console") || url.includes("auth") || url.includes("login")) {
							authUrl = url.replace(/[\)\]\}]+$/, "");
							console.log("[Auth] Found auth URL:", authUrl);
							shell.openExternal(authUrl).then(() => {
								console.log("[Auth] Opened URL in browser");
								urlOpened = true;
								clearTimeout(timeout);
								setTimeout(() => {
									resolve({
										success: true,
										message: "Browser opened for authentication. Please complete login in your browser, then you can use this profile."
									});
								}, 2e3);
							}).catch((err) => {
								console.error("[Auth] Failed to open URL:", err);
							});
							break;
						}
					}
					if (text.toLowerCase().includes("successfully") && text.toLowerCase().includes("authenticated")) {
						console.log("[Auth] Authentication success detected");
						clearTimeout(timeout);
						if (!urlOpened) resolve({
							success: true,
							message: "Authentication completed successfully!"
						});
					}
				});
				child.stderr.on("data", (data) => {
					const text = data.toString();
					console.log("[Auth] stderr:", text);
					output += text;
				});
				child.on("error", (error) => {
					console.error("[Auth] Process error:", error);
					clearTimeout(timeout);
					resolve({
						success: false,
						message: `Failed to start Claude CLI: ${error.message}`
					});
				});
				child.on("close", (code) => {
					clearTimeout(timeout);
					console.log("[Auth] Process exited with code:", code);
					console.log("[Auth] Full output:", output);
					if (!urlOpened) resolve({
						success: false,
						message: "Claude CLI exited without showing authentication URL. It may already be authenticated."
					});
				});
			} catch (error) {
				console.error("[Auth] Exception:", error);
				resolve({
					success: false,
					message: error.message || "Failed to start authentication"
				});
			}
		});
	});
	electron.ipcMain.handle("getAvailableModels", async (_event, profileId) => {
		const db = getDb();
		const os$3 = require("os");
		const fs$8 = require("fs");
		const https = require("https");
		const homedir = os$3.homedir();
		try {
			const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId);
			if (!profile) return {
				models: [],
				error: "Profile not found"
			};
			console.log("[Get Models] Fetching available models for profile:", profile.name);
			return new Promise((resolve) => {
				let authHeader = "";
				if (profile.auth_type === "apikey" && profile.keytar_service_key && electron.safeStorage.isEncryptionAvailable()) authHeader = electron.safeStorage.decryptString(Buffer.from(profile.keytar_service_key, "base64"));
				else if (profile.auth_type === "subscription" && profile.claude_config_dir) {
					const configDir = profile.claude_config_dir.replace("~", homedir);
					const claudeJsonPath = path.default.join(configDir, ".claude.json");
					if (fs$8.existsSync(claudeJsonPath)) try {
						const config = JSON.parse(fs$8.readFileSync(claudeJsonPath, "utf8"));
						if (config.auth && config.auth.token) authHeader = config.auth.token;
						else if (config.token) authHeader = config.token;
					} catch (e) {
						console.error("[Get Models] Error reading config:", e);
					}
				}
				if (!authHeader) {
					console.log("[Get Models] No auth available, returning default models");
					resolve({ models: [
						"claude-opus-4-7",
						"claude-sonnet-4-6",
						"claude-opus-4-6",
						"claude-sonnet-4-5-20250929",
						"claude-haiku-4-5-20251001",
						"claude-opus-4-5-20251101"
					] });
					return;
				}
				const options = {
					hostname: "api.anthropic.com",
					path: "/v1/models",
					method: "GET",
					headers: {
						"x-api-key": authHeader,
						"anthropic-version": "2023-06-01",
						"content-type": "application/json"
					}
				};
				const req = https.request(options, (res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						console.log("[Get Models] API Response:", data.substring(0, 200));
						try {
							const response = JSON.parse(data);
							if (response.data && Array.isArray(response.data)) {
								const models = response.data.map((m) => m.id);
								console.log("[Get Models] Found models:", models);
								resolve({ models });
							} else {
								console.log("[Get Models] Unexpected response format, using defaults");
								resolve({ models: [
									"claude-opus-4-7",
									"claude-sonnet-4-6",
									"claude-opus-4-6",
									"claude-sonnet-4-5-20250929",
									"claude-haiku-4-5-20251001",
									"claude-opus-4-5-20251101"
								] });
							}
						} catch (e) {
							console.error("[Get Models] Parse error:", e);
							resolve({ models: [
								"claude-opus-4-7",
								"claude-sonnet-4-6",
								"claude-opus-4-6",
								"claude-sonnet-4-5-20250929",
								"claude-haiku-4-5-20251001",
								"claude-opus-4-5-20251101"
							] });
						}
					});
				});
				req.on("error", (error) => {
					console.error("[Get Models] Request error:", error);
					resolve({
						models: [
							"claude-opus-4-7",
							"claude-sonnet-4-6",
							"claude-opus-4-6",
							"claude-sonnet-4-5-20250929",
							"claude-haiku-4-5-20251001",
							"claude-opus-4-5-20251101"
						],
						error: error.message
					});
				});
				req.end();
			});
		} catch (error) {
			console.error("[Get Models] Exception:", error);
			return {
				models: [
					"claude-opus-4-7",
					"claude-sonnet-4-6",
					"claude-opus-4-6",
					"claude-sonnet-4-5-20250929",
					"claude-haiku-4-5-20251001",
					"claude-opus-4-5-20251101"
				],
				error: error.message
			};
		}
	});
	electron.ipcMain.handle("verifyClaudeAuth", async (_event, profileName) => {
		const os$4 = require("os");
		const fs$9 = require("fs");
		const homedir = os$4.homedir();
		try {
			const configDir = path.default.join(homedir, ".claude-profiles", profileName);
			const credPathNew = path.default.join(configDir, ".claude.json");
			const credPathOld = path.default.join(configDir, ".credentials.json");
			console.log("[Verify Auth] Checking for credentials in:", configDir);
			console.log("[Verify Auth] New format (.claude.json):", credPathNew);
			console.log("[Verify Auth] Old format (.credentials.json):", credPathOld);
			if (fs$9.existsSync(credPathNew)) {
				console.log("[Verify Auth] Found .claude.json");
				try {
					const content = JSON.parse(fs$9.readFileSync(credPathNew, "utf8"));
					if (content.auth || content.token || content.access_token) return {
						success: true,
						message: "Authentication verified!"
					};
				} catch (e) {
					console.log("[Verify Auth] Error reading .claude.json:", e);
				}
			}
			if (fs$9.existsSync(credPathOld)) {
				console.log("[Verify Auth] Found .credentials.json");
				return {
					success: true,
					message: "Authentication verified!"
				};
			}
			if (fs$9.existsSync(configDir)) {
				const files = fs$9.readdirSync(configDir);
				console.log("[Verify Auth] Files in directory:", files);
				if (files.length > 0) return {
					success: true,
					message: "Authentication verified! (Credentials stored in system keychain)"
				};
			}
			console.log("[Verify Auth] No credentials found");
			return {
				success: false,
				message: "No credentials found. Please make sure you completed the authentication in your browser."
			};
		} catch (error) {
			console.error("[Verify Auth] Error:", error);
			return {
				success: false,
				message: "Error checking authentication"
			};
		}
	});
	electron.ipcMain.handle("closeWindow", () => {
		if (mainWindow) mainWindow.close();
	});
	electron.ipcMain.handle("minimizeWindow", () => {
		if (mainWindow) mainWindow.minimize();
	});
	electron.ipcMain.handle("maximizeWindow", () => {
		if (mainWindow) if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
}
//#endregion
