import { runtime } from "../../config/runtime.js";
import { db } from "../../db/index.js";

const STRAVA_BASE = "https://www.strava.com";
const API_BASE = "https://www.strava.com/api/v3";

export interface StravaTokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number; firstname?: string; lastname?: string };
}

export interface StoredStravaAccount {
  id: number;
  external_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
  meta_json: string | null;
}

export function authUrl(state: string, redirectUri: string): string {
  const clientId = runtime.stravaClientId();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all,profile:read_all",
    state,
  });
  return `${STRAVA_BASE}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<StravaTokenSet> {
  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: runtime.stravaClientId(),
      client_secret: runtime.stravaClientSecret(),
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<StravaTokenSet>;
}

async function refreshToken(refreshTok: string): Promise<StravaTokenSet> {
  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: runtime.stravaClientId(),
      client_secret: runtime.stravaClientSecret(),
      refresh_token: refreshTok,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<StravaTokenSet>;
}

export function getAccount(): StoredStravaAccount | null {
  return (
    (db
      .prepare(
        "SELECT id, external_id, access_token, refresh_token, expires_at, scope, meta_json FROM source_accounts WHERE kind = 'strava' ORDER BY id DESC LIMIT 1",
      )
      .get() as StoredStravaAccount | undefined) ?? null
  );
}

export function saveAccount(tokens: StravaTokenSet): StoredStravaAccount {
  const externalId = tokens.athlete?.id?.toString() ?? "self";
  const meta = tokens.athlete ? JSON.stringify(tokens.athlete) : null;
  const existing = db
    .prepare("SELECT id FROM source_accounts WHERE kind = 'strava' AND external_id = ?")
    .get(externalId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE source_accounts
       SET access_token = ?, refresh_token = ?, expires_at = ?, meta_json = COALESCE(?, meta_json), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(tokens.access_token, tokens.refresh_token, tokens.expires_at, meta, existing.id);
  } else {
    db.prepare(
      `INSERT INTO source_accounts (kind, external_id, access_token, refresh_token, expires_at, scope, meta_json)
       VALUES ('strava', ?, ?, ?, ?, ?, ?)`,
    ).run(externalId, tokens.access_token, tokens.refresh_token, tokens.expires_at, "activity:read_all,profile:read_all", meta);
  }
  return getAccount()!;
}

export function disconnect(): void {
  db.prepare("DELETE FROM source_accounts WHERE kind = 'strava'").run();
}

async function ensureFreshToken(): Promise<string> {
  const account = getAccount();
  if (!account) throw new Error("Strava is not connected. Connect it in Sources.");

  const now = Math.floor(Date.now() / 1000);
  // refresh if expiring within the next 5 minutes
  if (account.expires_at - now > 300) {
    return account.access_token;
  }
  const refreshed = await refreshToken(account.refresh_token);
  saveAccount({ ...refreshed, athlete: account.meta_json ? JSON.parse(account.meta_json) : undefined });
  return refreshed.access_token;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  start_date_local?: string;
  timezone?: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  calories?: number;
  suffer_score?: number;
  [k: string]: unknown;
}

export async function listActivities(opts: { afterUnix?: number; perPage?: number; page?: number }): Promise<StravaActivity[]> {
  const token = await ensureFreshToken();
  const params = new URLSearchParams();
  if (opts.afterUnix) params.set("after", String(opts.afterUnix));
  params.set("per_page", String(opts.perPage ?? 100));
  params.set("page", String(opts.page ?? 1));
  const res = await fetch(`${API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Strava listActivities failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<StravaActivity[]>;
}

export async function getActivityDetail(externalId: string): Promise<StravaActivity> {
  const token = await ensureFreshToken();
  const res = await fetch(`${API_BASE}/activities/${externalId}?include_all_efforts=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Strava activity detail failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<StravaActivity>;
}
