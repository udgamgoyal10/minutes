import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db } from "../config/db.ts";
import { env } from "../config/env.ts";

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  role: string;
};

const r = new Hono();

r.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return c.json({ error: "email and password required" }, 400);

  const user = db.query<UserRow, [string]>("SELECT * FROM users WHERE email = ?").get(body.email);
  if (!user) return c.json({ error: "invalid credentials" }, 401);

  const ok = await Bun.password.verify(body.password, user.password_hash);
  if (!ok) return c.json({ error: "invalid credentials" }, 401);

  const now = Math.floor(Date.now() / 1000);
  const access = await sign(
    { sub: user.id, email: user.email, role: user.role, typ: "access", iat: now, exp: now + env.accessTtl },
    env.jwtSecret,
  );
  const refresh = await sign(
    { sub: user.id, email: user.email, role: user.role, typ: "refresh", iat: now, exp: now + env.refreshTtl },
    env.jwtSecret,
  );

  return c.json({
    access_token: access,
    refresh_token: refresh,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

r.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null) as { refresh_token?: string } | null;
  if (!body?.refresh_token) return c.json({ error: "refresh_token required" }, 400);
  const { verify } = await import("hono/jwt");
  try {
    const payload = (await verify(body.refresh_token, env.jwtSecret, "HS256")) as {
      sub: number;
      email: string;
      role: string;
      typ?: string;
    };
    if (payload.typ !== "refresh") return c.json({ error: "wrong token type" }, 401);
    const now = Math.floor(Date.now() / 1000);
    const access = await sign(
      { sub: payload.sub, email: payload.email, role: payload.role, typ: "access", iat: now, exp: now + env.accessTtl },
      env.jwtSecret,
    );
    return c.json({ access_token: access });
  } catch {
    return c.json({ error: "invalid refresh token" }, 401);
  }
});

export default r;
