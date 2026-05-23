import type { Statement } from "better-sqlite3";
import { db } from "./index.js";

// Statements are prepared lazily — settings table may not exist yet
// at module-import time (e.g. before migrations run).
let _get: Statement<[string]> | null = null;
let _upsert: Statement<[string, string]> | null = null;
let _delete: Statement<[string]> | null = null;

function getStmt() {
  return (_get ??= db.prepare("SELECT value FROM settings WHERE key = ?"));
}
function upsertStmt() {
  return (_upsert ??= db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ));
}
function deleteStmt() {
  return (_delete ??= db.prepare("DELETE FROM settings WHERE key = ?"));
}

export const settings = {
  get(key: string): string | null {
    const row = getStmt().get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },
  set(key: string, value: string): void {
    upsertStmt().run(key, value);
  },
  delete(key: string): void {
    deleteStmt().run(key);
  },
  has(key: string): boolean {
    return this.get(key) !== null;
  },
};

export const SettingKeys = {
  AnthropicApiKey: "anthropic.api_key",
  AnthropicModel: "anthropic.model",
  StravaClientId: "strava.client_id",
  StravaClientSecret: "strava.client_secret",
} as const;
