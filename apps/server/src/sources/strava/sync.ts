import type { Statement } from "better-sqlite3";
import { db } from "../../db/index.js";
import { listActivities, type StravaActivity } from "./client.js";

let _upsert: Statement | null = null;
function upsertStmt(): Statement {
  return (_upsert ??= db.prepare(`
    INSERT INTO activities (
      source, external_id, kind, name, started_at, timezone,
      duration_s, moving_time_s, distance_m, elevation_gain_m,
      avg_hr, max_hr, avg_power_w, calories, perceived_exertion, raw_json, fetched_at
    ) VALUES (
      'strava', @external_id, @kind, @name, @started_at, @timezone,
      @duration_s, @moving_time_s, @distance_m, @elevation_gain_m,
      @avg_hr, @max_hr, @avg_power_w, @calories, @perceived_exertion, @raw_json, datetime('now')
    )
    ON CONFLICT(source, external_id) DO UPDATE SET
      kind = excluded.kind,
      name = excluded.name,
      started_at = excluded.started_at,
      timezone = excluded.timezone,
      duration_s = excluded.duration_s,
      moving_time_s = excluded.moving_time_s,
      distance_m = excluded.distance_m,
      elevation_gain_m = excluded.elevation_gain_m,
      avg_hr = excluded.avg_hr,
      max_hr = excluded.max_hr,
      avg_power_w = excluded.avg_power_w,
      calories = excluded.calories,
      perceived_exertion = excluded.perceived_exertion,
      raw_json = excluded.raw_json,
      fetched_at = datetime('now')
  `));
}

function rowFrom(a: StravaActivity) {
  return {
    external_id: String(a.id),
    kind: a.sport_type ?? a.type ?? null,
    name: a.name ?? null,
    started_at: a.start_date,
    timezone: a.timezone ?? null,
    duration_s: a.elapsed_time ?? null,
    moving_time_s: a.moving_time ?? null,
    distance_m: a.distance ?? null,
    elevation_gain_m: a.total_elevation_gain ?? null,
    avg_hr: a.average_heartrate ?? null,
    max_hr: a.max_heartrate ?? null,
    avg_power_w: a.average_watts ?? null,
    calories: a.calories ?? null,
    perceived_exertion: a.suffer_score ?? null,
    raw_json: JSON.stringify(a),
  };
}

export interface SyncResult {
  fetched: number;
  upserted: number;
  oldestFetched: string | null;
  newestFetched: string | null;
}

function lastSyncedStartedAt(): string | null {
  const row = db
    .prepare("SELECT started_at FROM activities WHERE source = 'strava' ORDER BY started_at DESC LIMIT 1")
    .get() as { started_at: string } | undefined;
  return row?.started_at ?? null;
}

/**
 * Sync Strava activities.
 * - First sync (no prior data): last `defaultDays` (default 90) days.
 * - Subsequent: incremental from the most recent stored activity.
 * Iterates pages until an empty page is returned, capped at maxPages.
 */
export async function syncStrava(opts: { defaultDays?: number; maxPages?: number } = {}): Promise<SyncResult> {
  const defaultDays = opts.defaultDays ?? 90;
  const maxPages = opts.maxPages ?? 20;

  const last = lastSyncedStartedAt();
  let after: number;
  if (last) {
    // Resync from a few hours before the last known to catch backfills/edits.
    after = Math.floor(new Date(last).getTime() / 1000) - 3 * 3600;
  } else {
    after = Math.floor(Date.now() / 1000) - defaultDays * 86400;
  }

  let fetched = 0;
  let upserted = 0;
  let oldest: string | null = null;
  let newest: string | null = null;

  const stmt = upsertStmt();
  const tx = db.transaction((batch: StravaActivity[]) => {
    for (const a of batch) {
      const row = rowFrom(a);
      stmt.run(row);
      upserted++;
      if (!oldest || row.started_at < oldest) oldest = row.started_at;
      if (!newest || row.started_at > newest) newest = row.started_at;
    }
  });

  for (let page = 1; page <= maxPages; page++) {
    const batch = await listActivities({ afterUnix: after, perPage: 100, page });
    if (batch.length === 0) break;
    fetched += batch.length;
    tx(batch);
    if (batch.length < 100) break;
  }

  return { fetched, upserted, oldestFetched: oldest, newestFetched: newest };
}
