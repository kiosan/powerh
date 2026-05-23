import type Anthropic from "@anthropic-ai/sdk";
import { queryActivities, weeklySummaries, activityById, type ActivityQuery } from "../../db/activities.js";
import { syncStrava } from "../../sources/strava/sync.js";
import { getAccount } from "../../sources/strava/client.js";
import { queryLabResults, type LabQuery } from "../../db/medical.js";
import { createNote, createPlan } from "../../db/notes.js";

export interface ToolHandler {
  definition: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const getActivities: ToolHandler = {
  definition: {
    name: "get_activities",
    description:
      "Query the user's training activities (synced from Strava). Returns the matching activities, newest first. " +
      "All units are SI: distance_m (meters), duration_s (seconds), elevation_gain_m (meters), avg_hr/max_hr (bpm), " +
      "avg_power_w (watts), perceived_exertion (Strava suffer score 0–500-ish). started_at is ISO 8601 UTC.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Lower bound on started_at, ISO 8601 (e.g. '2026-05-01' or '2026-05-01T00:00:00Z'). Optional." },
        to: { type: "string", description: "Upper bound on started_at. Optional." },
        kind: { type: "string", description: "Activity kind filter, substring match (e.g. 'Run', 'Ride', 'Swim', 'Hike'). Optional." },
        limit: { type: "integer", description: "Max rows to return, 1–500. Default 50.", minimum: 1, maximum: 500 },
      },
    },
  },
  run: async (input) => {
    const rows = queryActivities(input as ActivityQuery);
    return { count: rows.length, activities: rows };
  },
};

const getWeeklySummary: ToolHandler = {
  definition: {
    name: "get_weekly_summary",
    description:
      "Get aggregated weekly training summaries (count, total duration, total distance, total elevation, kinds breakdown) " +
      "for the past N weeks. Useful for trend analysis, training load questions, 'how was my week', etc.",
    input_schema: {
      type: "object",
      properties: {
        weeks: { type: "integer", description: "Number of weeks back to aggregate (1–52). Default 8.", minimum: 1, maximum: 52 },
      },
    },
  },
  run: async (input) => {
    const weeks = (input.weeks as number | undefined) ?? 8;
    return { weeks: weeklySummaries(weeks) };
  },
};

const getActivityDetail: ToolHandler = {
  definition: {
    name: "get_activity_detail",
    description: "Get the full stored detail for one activity by its internal id (from get_activities). Returns null if not found.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "Internal activity id." },
      },
      required: ["id"],
    },
  },
  run: async (input) => {
    const id = input.id as number;
    return { activity: activityById(id) };
  },
};

const triggerStravaSync: ToolHandler = {
  definition: {
    name: "trigger_strava_sync",
    description:
      "Pull the latest activities from Strava and store them locally. Use sparingly — only when the user explicitly asks for fresh data " +
      "or when the answer requires activities newer than what's stored.",
    input_schema: { type: "object", properties: {} },
  },
  run: async () => {
    if (!getAccount()) {
      return { error: "Strava is not connected. The user needs to connect it in the Sources tab." };
    }
    const result = await syncStrava();
    return result;
  },
};

const getLabResults: ToolHandler = {
  definition: {
    name: "get_lab_results",
    description:
      "Query the user's lab results (extracted from uploaded medical PDFs). Returns the matching rows, newest first. " +
      "Each row has: marker, marker_canonical (normalized key for trend comparison), value (numeric) or value_text (non-numeric), " +
      "unit, ref_low, ref_high, flag ('low'|'normal'|'high'|null), taken_at (ISO date). " +
      "Use marker_canonical for trend queries across multiple documents (e.g. all 'ldl' over time).",
    input_schema: {
      type: "object",
      properties: {
        marker: { type: "string", description: "Marker filter — matches canonical key exactly or marker name substring. E.g. 'ldl', 'hba1c', 'ferritin'. Optional." },
        from: { type: "string", description: "Lower bound on taken_at (ISO date). Optional." },
        to: { type: "string", description: "Upper bound on taken_at. Optional." },
        limit: { type: "integer", description: "Max rows, 1–1000. Default 200.", minimum: 1, maximum: 1000 },
      },
    },
  },
  run: async (input) => {
    const rows = queryLabResults(input as LabQuery);
    return { count: rows.length, results: rows };
  },
};

const writeNote: ToolHandler = {
  definition: {
    name: "write_note",
    description:
      "Persist a short note about the user that will be available in future conversations. " +
      "Use sparingly — only for durable facts the user has shared, stable preferences, goals they've stated, " +
      "or important observations from data (e.g. 'consistent low ferritin trend'). " +
      "Don't echo back what they just said in this turn; only save what's worth remembering later. " +
      "Notes are visible to the user and they can delete them.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["observation", "preference", "goal", "digest"], description: "Type of note." },
        body: { type: "string", description: "1–4000 chars. Be concise and specific." },
      },
      required: ["kind", "body"],
    },
  },
  run: async (input) => {
    const note = createNote(input.kind as string, input.body as string);
    return { note };
  },
};

const proposePlan: ToolHandler = {
  definition: {
    name: "propose_plan",
    description:
      "Save a training plan (or similar structured plan) for the user. Plans are stored as markdown and start in 'proposed' status — " +
      "the user can activate, archive, or delete them in the UI. Use this when the user has asked for a plan, not for casual suggestions.",
    input_schema: {
      type: "object",
      properties: {
        horizon: { type: "string", enum: ["session", "week", "month", "race-block"], description: "Time horizon of the plan." },
        body_md: { type: "string", description: "Plan content as markdown. Include rationale and concrete sessions." },
      },
      required: ["horizon", "body_md"],
    },
  },
  run: async (input) => {
    const plan = createPlan(input.horizon as string, input.body_md as string);
    return { plan };
  },
};

export const TOOLS: ToolHandler[] = [
  getActivities,
  getWeeklySummary,
  getActivityDetail,
  triggerStravaSync,
  getLabResults,
  writeNote,
  proposePlan,
];

export const TOOL_DEFS: Anthropic.Tool[] = TOOLS.map((t) => t.definition);

const byName = new Map(TOOLS.map((t) => [t.definition.name, t]));

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const h = byName.get(name);
  if (!h) return { error: `Unknown tool: ${name}` };
  try {
    return await h.run(input);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
