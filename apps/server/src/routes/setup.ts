import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings, SettingKeys } from "../db/settings.js";
import { runtime } from "../config/runtime.js";

const updateSchema = z.object({
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().optional(),
  stravaClientId: z.string().optional(),
  stravaClientSecret: z.string().optional(),
});

export async function setupRoutes(app: FastifyInstance) {
  app.get("/api/setup", async () => ({
    configured: {
      anthropic: runtime.isAnthropicConfigured(),
      strava: runtime.isStravaConfigured(),
    },
    model: runtime.anthropicModel(),
    // never return secrets — just whether they're set
    hasAnthropicKey: runtime.anthropicApiKey().length > 0,
    hasStravaClientId: runtime.stravaClientId().length > 0,
    hasStravaClientSecret: runtime.stravaClientSecret().length > 0,
  }));

  app.post("/api/setup", async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    const body = parsed.data;
    if (body.anthropicApiKey !== undefined) {
      if (body.anthropicApiKey === "") settings.delete(SettingKeys.AnthropicApiKey);
      else settings.set(SettingKeys.AnthropicApiKey, body.anthropicApiKey);
    }
    if (body.anthropicModel !== undefined) {
      settings.set(SettingKeys.AnthropicModel, body.anthropicModel);
    }
    if (body.stravaClientId !== undefined) {
      if (body.stravaClientId === "") settings.delete(SettingKeys.StravaClientId);
      else settings.set(SettingKeys.StravaClientId, body.stravaClientId);
    }
    if (body.stravaClientSecret !== undefined) {
      if (body.stravaClientSecret === "") settings.delete(SettingKeys.StravaClientSecret);
      else settings.set(SettingKeys.StravaClientSecret, body.stravaClientSecret);
    }
    return { ok: true };
  });
}
