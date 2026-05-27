import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.ts";
import { listAllProviders } from "../services/ai/index.ts";

const r = new Hono();
r.use("*", requireAuth);

r.get("/ai/providers", async (c) => {
  const providers = await listAllProviders();
  return c.json({ providers });
});

export default r;
