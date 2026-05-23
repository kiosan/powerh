import type { FastifyInstance } from "fastify";
import { authUrl, exchangeCode, getAccount, saveAccount, disconnect } from "../sources/strava/client.js";
import { syncStrava } from "../sources/strava/sync.js";
import { issueState, consumeState } from "../sources/strava/state.js";
import { runtime } from "../config/runtime.js";
import { db } from "../db/index.js";
import { env } from "../config/env.js";

function redirectUri(): string {
  // Strava only allows the registered "Authorization Callback Domain" (we tell users to use `localhost`).
  return `http://localhost:${env.port}/api/sources/strava/callback`;
}

// Where to send the user *after* the OAuth dance. In dev, the web app runs
// on a separate Vite port (5173); in prod the server serves the bundled UI
// from its own port.
function webAppOrigin(): string {
  if (env.nodeEnv === "production") return `http://localhost:${env.port}`;
  return "http://localhost:5173";
}

function htmlPage(opts: { title: string; body: string; redirectTo?: string; code: number }): { html: string; code: number } {
  const redirectScript = opts.redirectTo
    ? `<script>setTimeout(()=>{window.location.href=${JSON.stringify(opts.redirectTo)}},800)</script>`
    : "";
  return {
    code: opts.code,
    html: `<!doctype html><html><head><title>${opts.title}</title></head><body style="font-family:system-ui;padding:24px;background:#0e1116;color:#e6edf3"><h2>${opts.title}</h2>${opts.body}${redirectScript}</body></html>`,
  };
}

export async function stravaRoutes(app: FastifyInstance) {
  app.get("/api/sources/strava/status", async () => {
    const account = getAccount();
    const meta = account?.meta_json ? JSON.parse(account.meta_json) : null;
    const counts = db
      .prepare("SELECT COUNT(*) as n, MIN(started_at) as oldest, MAX(started_at) as newest FROM activities WHERE source = 'strava'")
      .get() as { n: number; oldest: string | null; newest: string | null };
    return {
      configured: runtime.isStravaConfigured(),
      connected: !!account,
      athlete: meta,
      activities: counts,
      callbackUrl: redirectUri(),
    };
  });

  app.get("/api/sources/strava/connect", async (_req, reply) => {
    if (!runtime.isStravaConfigured()) {
      reply.code(400);
      return { error: "Strava client_id/secret not set. Configure in Settings first." };
    }
    const state = issueState();
    const url = authUrl(state, redirectUri());
    return { url };
  });

  app.get<{ Querystring: { code?: string; state?: string; scope?: string; error?: string } }>(
    "/api/sources/strava/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      const sourcesUrl = `${webAppOrigin()}/sources`;

      if (error) {
        const page = htmlPage({
          title: "Помилка під'єднання Strava",
          body: `<p>${error}</p><p><a href="${sourcesUrl}" style="color:#f97316">Назад до Джерел</a></p>`,
          code: 400,
        });
        reply.code(page.code).type("text/html");
        return page.html;
      }
      if (!code || !state || !consumeState(state)) {
        const page = htmlPage({
          title: "Невалідний зворотний виклик",
          body: `<p>Відсутній або застарілий стан. Спробуйте під'єднатися ще раз.</p><p><a href="${sourcesUrl}" style="color:#f97316">Назад до Джерел</a></p>`,
          code: 400,
        });
        reply.code(page.code).type("text/html");
        return page.html;
      }
      try {
        const tokens = await exchangeCode(code);
        saveAccount(tokens);
        const page = htmlPage({
          title: "Strava під'єднано ✓",
          body: `<p>Можете закрити цю вкладку. Повертаємо вас до powerh…</p>`,
          redirectTo: sourcesUrl,
          code: 200,
        });
        reply.code(page.code).type("text/html");
        return page.html;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const page = htmlPage({
          title: "Помилка обміну токенів",
          body: `<pre style="white-space:pre-wrap;background:#161b22;padding:12px;border-radius:6px">${msg}</pre><p><a href="${sourcesUrl}" style="color:#f97316">Назад до Джерел</a></p>`,
          code: 500,
        });
        reply.code(page.code).type("text/html");
        return page.html;
      }
    },
  );

  app.post("/api/sources/strava/sync", async (_req, reply) => {
    try {
      const result = await syncStrava();
      return { ok: true, ...result };
    } catch (e) {
      reply.code(500);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post("/api/sources/strava/disconnect", async () => {
    disconnect();
    return { ok: true };
  });

  // Quick list for dashboard. Activities table backs the agent tool too.
  app.get<{ Querystring: { limit?: string } }>("/api/activities", async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 25), 1), 200);
    const rows = db
      .prepare(
        `SELECT id, source, external_id, kind, name, started_at, timezone,
                duration_s, moving_time_s, distance_m, elevation_gain_m,
                avg_hr, max_hr, avg_power_w, calories, perceived_exertion
         FROM activities
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit);
    return { activities: rows };
  });
}
