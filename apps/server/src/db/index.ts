import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";

mkdirSync(dirname(env.dbPath), { recursive: true });
mkdirSync(env.uploadsDir, { recursive: true });

export const db = new Database(env.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

export function closeDb() {
  db.close();
}
