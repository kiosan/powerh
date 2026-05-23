import type { FastifyInstance } from "fastify";
import { runtime } from "../config/runtime.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    version: "0.1.0",
    configured: {
      anthropic: runtime.isAnthropicConfigured(),
      strava: runtime.isStravaConfigured(),
    },
  }));
}
