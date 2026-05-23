import { db } from "../db/index.js";
import { getAccount } from "../sources/strava/client.js";
import { recentNotes } from "../db/notes.js";
import { markerSummaries } from "../db/medical.js";
import { readPrompt, interpolate } from "./prompts.js";

interface Profile {
  display_name: string | null;
  birth_year: number | null;
  sex: string | null;
  height_cm: number | null;
  notes: string | null;
}

function loadProfile(): Profile | null {
  return (db.prepare("SELECT display_name, birth_year, sex, height_cm, notes FROM user_profile WHERE id = 1").get() as
    | Profile
    | undefined) ?? null;
}

function dataSummary(): string {
  const counts = db
    .prepare(
      "SELECT COUNT(*) as n, MIN(started_at) as oldest, MAX(started_at) as newest FROM activities WHERE source = 'strava'",
    )
    .get() as { n: number; oldest: string | null; newest: string | null };
  const labCount = db.prepare("SELECT COUNT(*) as n FROM lab_results").get() as { n: number };

  const lines: string[] = [];
  const strava = getAccount();
  lines.push(`Strava: ${strava ? "під'єднано" : "не під'єднано"}.`);
  if (counts.n > 0) {
    lines.push(`Збережено активностей: ${counts.n} (з ${counts.oldest} по ${counts.newest}).`);
  } else {
    lines.push("Збережено активностей: 0.");
  }
  lines.push(`Збережено результатів аналізів: ${labCount.n}.`);
  return lines.join(" ");
}

function profileBlock(): string {
  const p = loadProfile();
  if (!p) return "";
  const lines: string[] = ["Профіль користувача:"];
  if (p.display_name) lines.push(`- Ім'я: ${p.display_name}`);
  if (p.birth_year) lines.push(`- Рік народження: ${p.birth_year}`);
  if (p.sex) lines.push(`- Стать: ${p.sex}`);
  if (p.height_cm) lines.push(`- Зріст: ${p.height_cm} см`);
  if (p.notes) lines.push(`- Нотатки: ${p.notes}`);
  return lines.join("\n");
}

function notesBlock(): string {
  const notes = recentNotes(15);
  if (notes.length === 0) return "";
  const lines: string[] = ["Нотатки про користувача з попередніх розмов (найновіші першими):"];
  for (const n of notes) {
    lines.push(`- [${n.kind} ${n.created_at}] ${n.body}`);
  }
  return lines.join("\n");
}

function labHistoryBlock(): string {
  const markers = markerSummaries();
  if (markers.length === 0) return "";

  // Distinct sample dates across all documents
  const dates = new Set<string>();
  for (const m of markers) {
    for (const h of m.history) {
      if (h.taken_at) dates.add(h.taken_at);
    }
  }
  const sortedDates = [...dates].sort();

  const trended = markers.filter((m) => m.measurements >= 2);
  const abnormalLatest = markers.filter((m) => m.latest_flag === "low" || m.latest_flag === "high");

  const lines: string[] = ["Огляд медичних даних (для контексту — деталі вибирай через get_lab_results):"];
  lines.push(
    `- Збережено унікальних маркерів: ${markers.length}; з них з історією (≥2 виміри): ${trended.length}.`,
  );
  if (sortedDates.length > 0) {
    if (sortedDates.length === 1) {
      lines.push(`- Дата аналізу: ${sortedDates[0]}.`);
    } else {
      lines.push(
        `- Дати аналізів (${sortedDates.length}): від ${sortedDates[0]} до ${sortedDates[sortedDates.length - 1]} (${sortedDates.join(", ")}).`,
      );
    }
  }
  if (abnormalLatest.length > 0) {
    const sample = abnormalLatest.slice(0, 8).map((m) =>
      `${m.marker_canonical}=${m.latest_value ?? m.latest_value_text ?? "?"}${m.unit ?? ""}(${m.latest_flag})`,
    );
    lines.push(
      `- За останніми даними поза нормою (${abnormalLatest.length}): ${sample.join(", ")}${abnormalLatest.length > 8 ? "…" : ""}.`,
    );
  }
  if (trended.length > 0) {
    const top = trended
      .slice(0, 10)
      .map((m) => `${m.marker_canonical} (${m.measurements} вимірів, ${m.earliest_taken_at} → ${m.latest_taken_at})`);
    lines.push(`- Маркери з історією (топ ${top.length}): ${top.join("; ")}.`);
  }
  return lines.join("\n");
}

/**
 * Build the chat system prompt by reading the user-editable template
 * from disk (~/.powerh/prompts/chat-system.md) and substituting variables.
 */
function allVariables(): Record<string, string> {
  return {
    today: new Date().toISOString().slice(0, 10),
    profile_block: profileBlock(),
    data_summary: dataSummary(),
    lab_history_block: labHistoryBlock(),
    notes_block: notesBlock(),
  };
}

export function buildSystemPrompt(): string {
  const { body } = readPrompt("chat-system");
  return interpolate(body, allVariables());
}

/** Expose the same variables for the editor's "preview" feature. */
export function previewVariables(): Record<string, string> {
  return allVariables();
}
