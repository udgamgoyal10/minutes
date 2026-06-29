import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./config/env.ts";
import { runMigrations } from "./config/migrations.ts";
import { runSeeders } from "./config/seed.ts";
import authRoutes from "./routes/auth.ts";
import meetingsRoutes from "./routes/meetings.ts";
import sourcesRoutes from "./routes/sources.ts";
import sectionsRoutes from "./routes/sections.ts";
import aiRoutes from "./routes/ai.ts";
import exportRoutes from "./routes/export.ts";
import usersRoutes from "./routes/users.ts";

await runMigrations();
await runSeeders();

const app = new Hono();
app.use("*", logger());
app.use("*", cors({ origin: env.publicUrl.split(",").map((s) => s.trim()), credentials: true }));

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    env: env.nodeEnv,
    ollama: env.ollama.baseUrl,
    gemini_configured: Boolean(env.gemini.apiKey),
  }),
);

app.route("/api/auth", authRoutes);
app.route("/api", meetingsRoutes);
app.route("/api", sourcesRoutes);
app.route("/api", sectionsRoutes);
app.route("/api", aiRoutes);
app.route("/api", exportRoutes);
app.route("/api", usersRoutes);

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: err.message }, 500);
});

const port = env.port;
console.log(`[server] listening on http://localhost:${port}`);
export default { port, fetch: app.fetch };
