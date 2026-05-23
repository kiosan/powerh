import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { streamChat } from "../agent/loop.js";
import { conversations } from "../db/conversations.js";

const chatBodySchema = z.object({
  conversationId: z.number().int().nullable().optional(),
  message: z.string().min(1).max(10_000),
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/conversations", async () => {
    return { conversations: conversations.list(50) };
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    const conv = conversations.get(id);
    if (!conv) {
      reply.code(404);
      return { error: "not found" };
    }
    const messages = conversations.messages(id).map((m) => ({
      id: m.id,
      role: m.role,
      content: JSON.parse(m.content),
      created_at: m.created_at,
    }));
    return { conversation: conv, messages };
  });

  app.patch<{ Params: { id: string }; Body: { title?: string } }>(
    "/api/conversations/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        reply.code(400);
        return { error: "invalid id" };
      }
      const title = (req.body?.title ?? "").trim();
      if (!title) {
        reply.code(400);
        return { error: "title required" };
      }
      if (title.length > 200) {
        reply.code(400);
        return { error: "title too long" };
      }
      conversations.setTitle(id, title);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { error: "invalid id" };
    }
    conversations.delete(id);
    return { ok: true };
  });

  app.post("/api/chat", async (req, reply) => {
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    const { conversationId, message } = parsed.data;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
    });

    try {
      for await (const chunk of streamChat(conversationId ?? null, message)) {
        if (chunk.type === "text") {
          send("delta", { text: chunk.text, conversationId: chunk.conversationId });
        } else if (chunk.type === "tool") {
          send("tool", chunk.tool);
        } else if (chunk.type === "done") {
          send("done", { conversationId: chunk.conversationId });
        } else if (chunk.type === "error") {
          send("error", { error: chunk.error, conversationId: chunk.conversationId });
        }
      }
    } catch (e) {
      send("error", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });
}
