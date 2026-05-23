import { db } from "./index.js";

export interface ActivityRow {
  id: number;
  source: string;
  external_id: string;
  kind: string | null;
  name: string | null;
  started_at: string;
  timezone: string | null;
  duration_s: number | null;
  moving_time_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power_w: number | null;
  calories: number | null;
  perceived_exertion: number | null;
}

export interface ActivityQuery {
  from?: string; // ISO date or datetime
  to?: string;
  kind?: string; // matches kind exactly OR by sport family substring (case-insensitive)
  limit?: number;
}

export function queryActivities(q: ActivityQuery): ActivityRow[] {
  const where: string[] = ["source = 'strava'"];
  const params: unknown[] = [];
  if (q.from) {
    where.push("started_at >= ?");
    params.push(q.from);
  }
  if (q.to) {
    where.push("started_at <= ?");
    params.push(q.to);
  }
  if (q.kind) {
    where.push("LOWER(kind) LIKE ?");
    params.push(`%${q.kind.toLowerCase()}%`);
  }
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const sql = `
    SELECT id, source, external_id, kind, name, started_at, timezone,
           duration_s, moving_time_s, distance_m, elevation_gain_m,
           avg_hr, max_hr, avg_power_w, calories, perceived_exertion
    FROM activities
    WHERE ${where.join(" AND ")}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return db.prepare(sql).all(...params) as ActivityRow[];
}

export interface WeeklySummary {
  week_start: string; // ISO date (Monday)
  count: number;
  total_duration_s: number;
  total_distance_m: number;
  total_elevation_m: number;
  by_kind: Record<string, number>;
}

export function weeklySummaries(weeks: number): WeeklySummary[] {
  const since = new Date(Date.now() - weeks * 7 * 86400 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT kind, started_at, duration_s, distance_m, elevation_gain_m
       FROM activities WHERE source = 'strava' AND started_at >= ?`,
    )
    .all(since) as Array<{
    kind: string | null;
    started_at: string;
    duration_s: number | null;
    distance_m: number | null;
    elevation_gain_m: number | null;
  }>;

  const buckets = new Map<string, WeeklySummary>();
  for (const r of rows) {
    const d = new Date(r.started_at);
    const day = d.getUTCDay() || 7; // 1..7, Monday=1
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
    const key = monday.toISOString().slice(0, 10);
    const cur =
      buckets.get(key) ?? {
        week_start: key,
        count: 0,
        total_duration_s: 0,
        total_distance_m: 0,
        total_elevation_m: 0,
        by_kind: {},
      };
    cur.count += 1;
    cur.total_duration_s += r.duration_s ?? 0;
    cur.total_distance_m += r.distance_m ?? 0;
    cur.total_elevation_m += r.elevation_gain_m ?? 0;
    const kind = r.kind ?? "Other";
    cur.by_kind[kind] = (cur.by_kind[kind] ?? 0) + 1;
    buckets.set(key, cur);
  }
  return [...buckets.values()].sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

export function activityById(id: number): ActivityRow | null {
  return (
    (db
      .prepare(
        `SELECT id, source, external_id, kind, name, started_at, timezone,
                duration_s, moving_time_s, distance_m, elevation_gain_m,
                avg_hr, max_hr, avg_power_w, calories, perceived_exertion
         FROM activities WHERE id = ?`,
      )
      .get(id) as ActivityRow | undefined) ?? null
  );
}
