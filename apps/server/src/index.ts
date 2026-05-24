import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { setupRoutes } from "./routes/setup.js";
import { chatRoutes } from "./routes/chat.js";
import { stravaRoutes } from "./routes/strava.js";
import { medicalRoutes } from "./routes/medical.js";
import { notesRoutes } from "./routes/notes.js";
import { promptsRoutes } from "./routes/prompts.js";
import { scheduleWeeklyDigest } from "./jobs/weekly-digest.js";
import { closeDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";

async function main() {
  runMigrations();

  const app = Fastify({
    logger: { level: env.nodeEnv === "production" ? "info" : "debug" },
  });

  // Origin allowlist: the API only accepts cross-origin requests from the
  // local Vite dev server (port 5173) and from itself. Other origins are
  // rejected — important because the server has no auth and any browsing
  // session reaching it can read all data.
  const allowedOrigins = new Set([
    `http://localhost:5173`,
    `http://127.0.0.1:5173`,
    `http://localhost:${env.port}`,
    `http://127.0.0.1:${env.port}`,
  ]);

  await app.register(cors, {
    origin(origin, cb) {
      // No Origin header → same-origin browser request, curl, or server-side
      // call. Allow.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.has(origin));
    },
    credentials: true,
  });

  // Host header allowlist: defends against DNS rebinding. A malicious site
  // can point its DNS at 127.0.0.1, which makes the browser see the request
  // as same-origin (bypassing CORS) — but the Host header in the request
  // will be the attacker's domain. By rejecting unexpected Host values, we
  // close that door.
  const allowedHosts = new Set([
    `localhost:${env.port}`,
    `127.0.0.1:${env.port}`,
    `localhost`,
    `127.0.0.1`,
  ]);
  app.addHook("onRequest", async (req, reply) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      reply.code(403).send({ error: "forbidden host" });
    }
  });

  await app.register(healthRoutes);
  await app.register(setupRoutes);
  await app.register(chatRoutes);
  await app.register(stravaRoutes);
  await app.register(medicalRoutes);
  await app.register(notesRoutes);
  await app.register(promptsRoutes);

  scheduleWeeklyDigest();

  app.get("/", async () => ({
    name: "powerh",
    docs: "API only — run the web app from apps/web in dev, or use the bundled UI in prod.",
  }));

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`powerh server ready — data dir: ${env.dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
