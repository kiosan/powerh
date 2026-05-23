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

  await app.register(cors, {
    origin: env.nodeEnv === "production" ? false : true,
    credentials: true,
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
