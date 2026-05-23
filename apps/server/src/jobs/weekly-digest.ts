import cron from "node-cron";
import { getAnthropic } from "../agent/client.js";
import { runtime } from "../config/runtime.js";
import { weeklySummaries, queryActivities } from "../db/activities.js";
import { queryLabResults } from "../db/medical.js";
import { createNote, recentNotes } from "../db/notes.js";
import { readPrompt } from "../agent/prompts.js";

async function runDigest(): Promise<{ ok: boolean; note_id?: number; reason?: string }> {
  if (!runtime.isAnthropicConfigured()) {
    return { ok: false, reason: "anthropic-not-configured" };
  }

  const sinceISO = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const recent = queryActivities({ from: sinceISO, limit: 50 });
  const summaries = weeklySummaries(4);
  const labs = queryLabResults({ limit: 30 });

  if (recent.length === 0 && labs.length === 0) {
    return { ok: false, reason: "no-data" };
  }

  const recentNoteSlugs = recentNotes(5).map((n) => `[${n.kind}] ${n.body.slice(0, 120)}`);

  const { body: systemTemplate } = readPrompt("weekly-digest");

  const dataBlock = `\nДані:\n- Активності (останні 7 днів, рядків: ${recent.length}): ${JSON.stringify(recent.slice(0, 20))}\n- Тижневі підсумки (останні 4 тижні): ${JSON.stringify(summaries)}\n- Результати аналізів (найновіші): ${JSON.stringify(labs.slice(0, 15))}\n- Твої попередні нотатки про цього користувача (для контексту): ${JSON.stringify(recentNoteSlugs)}`;

  const client = getAnthropic();
  const response = await client.messages.create({
    model: runtime.anthropicModel(),
    max_tokens: 1024,
    system: systemTemplate,
    messages: [{ role: "user", content: "Сформуй тижневий огляд за наступними даними." + dataBlock }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { ok: false, reason: "no-text-from-model" };
  }
  const note = createNote("digest", textBlock.text);
  return { ok: true, note_id: note.id };
}

let scheduled = false;

export function scheduleWeeklyDigest(): void {
  if (scheduled) return;
  // Every Monday at 07:00 local time. Runs in-process; survives only while server runs.
  cron.schedule("0 7 * * 1", () => {
    runDigest()
      .then((r) => {
        // eslint-disable-next-line no-console
        console.log("[weekly-digest]", r);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[weekly-digest] failed:", e);
      });
  });
  scheduled = true;
}

export { runDigest };
