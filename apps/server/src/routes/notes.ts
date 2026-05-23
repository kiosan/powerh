import type { FastifyInstance } from "fastify";
import { listNotes, deleteNote, listPlans, updatePlan, deletePlan } from "../db/notes.js";
import { runDigest } from "../jobs/weekly-digest.js";

export async function notesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { kind?: string; limit?: string } }>("/api/notes", async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    return { notes: listNotes(req.query.kind, limit) };
  });

  app.delete<{ Params: { id: string } }>("/api/notes/:id", async (req) => {
    deleteNote(Number(req.params.id));
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>("/api/plans", async (req) => {
    return { plans: listPlans(req.query.status) };
  });

  app.patch<{ Params: { id: string }; Body: { status?: string; horizon?: string | null; body_md?: string } }>(
    "/api/plans/:id",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        reply.code(400);
        return { error: "invalid id" };
      }
      try {
        const plan = updatePlan(id, req.body);
        if (!plan) {
          reply.code(404);
          return { error: "not found" };
        }
        return { plan };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/plans/:id", async (req) => {
    deletePlan(Number(req.params.id));
    return { ok: true };
  });

  // Manual digest trigger — handy for testing without waiting for Monday 7am
  app.post("/api/digest/run", async (_req, reply) => {
    const r = await runDigest();
    if (!r.ok) {
      reply.code(400);
      return r;
    }
    return r;
  });
}
