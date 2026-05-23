import { db } from "./index.js";

export interface AgentNoteRow {
  id: number;
  kind: string;
  body: string;
  created_at: string;
}

export interface PlanRow {
  id: number;
  horizon: string | null;
  body_md: string;
  status: string;
  created_at: string;
}

const NOTE_KINDS = new Set(["observation", "preference", "goal", "digest"]);

export function createNote(kind: string, body: string): AgentNoteRow {
  if (!NOTE_KINDS.has(kind)) throw new Error(`Invalid note kind: ${kind}`);
  if (!body || body.length > 4000) throw new Error("Note body must be 1–4000 chars");
  const info = db.prepare("INSERT INTO agent_notes (kind, body) VALUES (?, ?)").run(kind, body);
  return db.prepare("SELECT * FROM agent_notes WHERE id = ?").get(info.lastInsertRowid) as AgentNoteRow;
}

export function recentNotes(limit = 20): AgentNoteRow[] {
  return db.prepare("SELECT * FROM agent_notes ORDER BY created_at DESC LIMIT ?").all(limit) as AgentNoteRow[];
}

export function listNotes(kind?: string, limit = 100): AgentNoteRow[] {
  if (kind) {
    return db
      .prepare("SELECT * FROM agent_notes WHERE kind = ? ORDER BY created_at DESC LIMIT ?")
      .all(kind, limit) as AgentNoteRow[];
  }
  return db.prepare("SELECT * FROM agent_notes ORDER BY created_at DESC LIMIT ?").all(limit) as AgentNoteRow[];
}

export function deleteNote(id: number): void {
  db.prepare("DELETE FROM agent_notes WHERE id = ?").run(id);
}

const PLAN_HORIZONS = new Set(["week", "month", "race-block", "session"]);

export function createPlan(horizon: string | null, bodyMd: string): PlanRow {
  if (horizon && !PLAN_HORIZONS.has(horizon)) throw new Error(`Invalid plan horizon: ${horizon}`);
  if (!bodyMd || bodyMd.length > 20_000) throw new Error("Plan body must be 1–20000 chars");
  const info = db.prepare("INSERT INTO plans (horizon, body_md) VALUES (?, ?)").run(horizon, bodyMd);
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(info.lastInsertRowid) as PlanRow;
}

export function listPlans(status?: string): PlanRow[] {
  if (status) {
    return db.prepare("SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC").all(status) as PlanRow[];
  }
  return db.prepare("SELECT * FROM plans ORDER BY created_at DESC").all() as PlanRow[];
}

export function setPlanStatus(id: number, status: string): PlanRow | null {
  if (!["proposed", "active", "archived"].includes(status)) throw new Error(`Invalid status: ${status}`);
  db.prepare("UPDATE plans SET status = ? WHERE id = ?").run(status, id);
  return (db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined) ?? null;
}

export function updatePlan(
  id: number,
  patch: { horizon?: string | null; body_md?: string; status?: string },
): PlanRow | null {
  if (patch.status && !["proposed", "active", "archived"].includes(patch.status)) {
    throw new Error(`Invalid status: ${patch.status}`);
  }
  if (patch.horizon && !PLAN_HORIZONS.has(patch.horizon)) {
    throw new Error(`Invalid horizon: ${patch.horizon}`);
  }
  if (patch.body_md !== undefined && (!patch.body_md || patch.body_md.length > 20_000)) {
    throw new Error("body_md must be 1–20000 chars");
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if ("horizon" in patch) {
    sets.push("horizon = ?");
    params.push(patch.horizon ?? null);
  }
  if ("body_md" in patch && patch.body_md !== undefined) {
    sets.push("body_md = ?");
    params.push(patch.body_md);
  }
  if ("status" in patch && patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (sets.length === 0) return (db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined) ?? null;
  params.push(id);
  db.prepare(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return (db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined) ?? null;
}

export function deletePlan(id: number): void {
  db.prepare("DELETE FROM plans WHERE id = ?").run(id);
}
