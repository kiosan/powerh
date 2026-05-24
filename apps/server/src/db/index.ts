import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";

// Tighten permissions on the data dir before anything is created in it.
// Both the SQLite file (and its -wal/-shm companions) and uploaded PDFs
// contain personal data — make them user-only.
mkdirSync(dirname(env.dbPath), { recursive: true, mode: 0o700 });
mkdirSync(env.uploadsDir, { recursive: true, mode: 0o700 });
try {
  chmodSync(dirname(env.dbPath), 0o700);
  chmodSync(env.uploadsDir, 0o700);
} catch {
  // Best effort; on Windows chmod is a no-op.
}

export const db = new Database(env.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// chmod the DB file (and its WAL companions get created with the same
// umask, so this is a baseline — better-sqlite3 doesn't expose per-file
// permissions itself).
try {
  chmodSync(env.dbPath, 0o600);
} catch {
  // Best effort.
}

export function closeDb() {
  db.close();
}
