import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: any;

const DB_FILENAME = 'claudedesk.sqlite';

/** Older Electron userData folders we may have used before the app was renamed. */
function legacyDbCandidates(currentDbPath: string): string[] {
  const appData = app.getPath('appData');
  return [
    path.join(appData, 'agent-app', DB_FILENAME),
    path.join(appData, 'claudedeck', DB_FILENAME),
    path.join(appData, 'ClaudeDeck', DB_FILENAME),
  ].filter(p => path.resolve(p) !== path.resolve(currentDbPath));
}

function sqliteProfileCount(dbPath: string): number {
  try {
    const req = eval('require');
    const Database = req('better-sqlite3');
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = probe.prepare('SELECT COUNT(*) as n FROM profiles').get() as { n: number };
      return row?.n ?? 0;
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
function migrateLegacyDatabaseIfNeeded(currentDbPath: string) {
  const currentExists = fs.existsSync(currentDbPath);
  const currentCount = currentExists ? sqliteProfileCount(currentDbPath) : 0;
  if (currentCount > 0) return;

  for (const legacyPath of legacyDbCandidates(currentDbPath)) {
    if (!fs.existsSync(legacyPath)) continue;
    const legacyCount = sqliteProfileCount(legacyPath);
    if (legacyCount <= 0) continue;

    fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
    if (currentExists) {
      const backup = `${currentDbPath}.pre-migrate-${Date.now()}.bak`;
      fs.copyFileSync(currentDbPath, backup);
      console.log('[DB] Backed up empty/current DB to', backup);
    }

    fs.copyFileSync(legacyPath, currentDbPath);
    for (const suffix of ['-wal', '-shm']) {
      const src = legacyPath + suffix;
      const dest = currentDbPath + suffix;
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      else if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }

    console.log(`[DB] Migrated ${legacyCount} profile(s) from legacy path:`, legacyPath);
    return;
  }
}

export function initDb() {
  const req = eval('require');
  const Database = req('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), DB_FILENAME);

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

  // Migration: Rename 'alias' column to 'name' if it exists
  try {
    const columns = db.prepare("PRAGMA table_info(profiles)").all() as any[];
    const hasAlias = columns.some((col: any) => col.name === 'alias');
    const hasName = columns.some((col: any) => col.name === 'name');

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
      console.log('Database migration: Renamed alias column to name');
    }
  } catch (e) {
    console.error('Migration error (likely no existing data):', e);
  }

  // Migration: Add 'permission_mode' column to sessions if it doesn't exist
  try {
    const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const hasPermissionMode = sessionColumns.some((col: any) => col.name === 'permission_mode');

    if (!hasPermissionMode) {
      db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT DEFAULT 'default'`);
      console.log('Database migration: Added permission_mode column to sessions');
    }
  } catch (e) {
    console.error('Migration error (permission_mode):', e);
  }

  // Migration: claude_bound marks sessions whose Claude Code conversation id matches
  // our sessions.id (we passed --session-id on first spawn), so reopen can --resume.
  try {
    const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const hasClaudeBound = sessionColumns.some((col: any) => col.name === 'claude_bound');

    if (!hasClaudeBound) {
      db.exec(`ALTER TABLE sessions ADD COLUMN claude_bound INTEGER DEFAULT 0`);
      console.log('Database migration: Added claude_bound column to sessions');
    }
  } catch (e) {
    console.error('Migration error (claude_bound):', e);
  }

  // Migration: human-readable session title (e.g. "TDD analysis for experiments-api")
  try {
    const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const hasTitle = sessionColumns.some((col: any) => col.name === 'title');

    if (!hasTitle) {
      db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
      console.log('Database migration: Added title column to sessions');
    }
  } catch (e) {
    console.error('Migration error (title):', e);
  }

  // Migration: per-session highlight color for tabs/sidebar identification
  try {
    const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all() as any[];
    const hasColor = sessionColumns.some((col: any) => col.name === 'color');

    if (!hasColor) {
      db.exec(`ALTER TABLE sessions ADD COLUMN color TEXT`);
      const palette = ['#D4A843', '#4CAF7D', '#5B8DEF', '#B583D8', '#5BC6D8', '#E05C5C', '#E08A4D', '#3DB8A0'];
      const rows: any[] = db.prepare('SELECT id FROM sessions ORDER BY started_at ASC').all();
      const update = db.prepare('UPDATE sessions SET color = ? WHERE id = ?');
      rows.forEach((row, i) => update.run(palette[i % palette.length], row.id));
      console.log('Database migration: Added color column to sessions');
    }
  } catch (e) {
    console.error('Migration error (color):', e);
  }
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}
