import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PROMPTS, type PromptId, readPrompt, writePrompt, resetPrompt, interpolate } from "../agent/prompts.js";
import { previewVariables } from "../agent/system-prompt.js";

const ALLOWED_IDS = Object.keys(PROMPTS) as PromptId[];

function isPromptId(id: string): id is PromptId {
  return (ALLOWED_IDS as string[]).includes(id);
}

// Per-prompt size cap. The chat-system prompt is sent on every chat turn
// (and on every tool-use iteration within a turn), so a generous cap
// inflates Anthropic input-token cost. The other two prompts run once
// per event so they can be longer.
const MAX_BODY_SIZE: Record<string, number> = {
  "chat-system": 12_000,
  "weekly-digest": 20_000,
  "lab-extraction": 20_000,
};

const writeSchema = z.object({
  body: z.string().max(50_000),
});

export async function promptsRoutes(app: FastifyInstance) {
  app.get("/api/prompts", async () => {
    // List all prompts with their current state
    return {
      prompts: ALLOWED_IDS.map((id) => {
        const meta = PROMPTS[id];
        const { modified_at, isDefault } = readPrompt(id);
        return {
          id: meta.id,
          title: meta.title,
          description: meta.description,
          filename: meta.filename,
          variables: meta.variables,
          notes: meta.notes,
          modified_at,
          is_default: isDefault,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/prompts/:id", async (req, reply) => {
    if (!isPromptId(req.params.id)) {
      reply.code(404);
      return { error: "unknown prompt id" };
    }
    const meta = PROMPTS[req.params.id];
    const { body, modified_at, isDefault } = readPrompt(req.params.id);
    return {
      id: meta.id,
      title: meta.title,
      description: meta.description,
      filename: meta.filename,
      variables: meta.variables,
      notes: meta.notes,
      body,
      default_body: meta.defaultBody,
      modified_at,
      is_default: isDefault,
    };
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/prompts/:id", async (req, reply) => {
    if (!isPromptId(req.params.id)) {
      reply.code(404);
      return { error: "unknown prompt id" };
    }
    const parsed = writeSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    const maxSize = MAX_BODY_SIZE[req.params.id] ?? 20_000;
    if (parsed.data.body.length > maxSize) {
      reply.code(400);
      return {
        error: `Цей промпт обмежено ${maxSize.toLocaleString()} символами (${parsed.data.body.length.toLocaleString()} надано). Системна інструкція чату надсилається на кожне повідомлення, тож тримай її стислою.`,
      };
    }
    writePrompt(req.params.id, parsed.data.body);
    const { body, modified_at, isDefault } = readPrompt(req.params.id);
    return { ok: true, body, modified_at, is_default: isDefault };
  });

  app.post<{ Params: { id: string } }>("/api/prompts/:id/reset", async (req, reply) => {
    if (!isPromptId(req.params.id)) {
      reply.code(404);
      return { error: "unknown prompt id" };
    }
    const body = resetPrompt(req.params.id);
    return { ok: true, body, is_default: true };
  });

  // Returns the fully-resolved chat-system prompt with current variables
  // substituted — for the "preview" pane in the editor.
  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    "/api/prompts/:id/preview",
    async (req, reply) => {
      if (!isPromptId(req.params.id)) {
        reply.code(404);
        return { error: "unknown prompt id" };
      }
      // Allow previewing a draft body (without saving) — falls back to saved body
      const draft = typeof req.body?.body === "string" ? req.body.body : readPrompt(req.params.id).body;
      if (req.params.id === "chat-system") {
        return { rendered: interpolate(draft, previewVariables()) };
      }
      // Other prompts have no variables
      return { rendered: draft };
    },
  );
}
