import "dotenv/config";
import { homedir } from "node:os";
import { join } from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const dataDir = process.env.POWERH_DATA_DIR?.trim() || join(homedir(), ".powerh");

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "5174")),
  host: optional("HOST", "127.0.0.1"),
  dataDir,
  dbPath: join(dataDir, "powerh.sqlite"),
  uploadsDir: join(dataDir, "uploads"),

  // Anthropic — required for agent functionality, but server boots without it
  // so the user can configure it via the first-run UI.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-opus-4-7"),

  // Strava — optional, configured at runtime
  stravaClientId: process.env.STRAVA_CLIENT_ID ?? "",
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET ?? "",
};

export const isConfigured = {
  anthropic: () => env.anthropicApiKey.length > 0,
  strava: () => env.stravaClientId.length > 0 && env.stravaClientSecret.length > 0,
};

export { required };
