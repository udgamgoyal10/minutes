import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { db } from "../config/db.ts";
import { isSuperAdmin, requireAuth } from "../middleware/auth.ts";

const r = new Hono();
r.use("*", requireAuth);

type UserRow = {
  id: number;
  email: string;
  role: string;
  two_factor_enabled: number;
  created_at: string;
  updated_at: string | null;
};

r.get("/users", (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const users = db.query<UserRow, []>(
    `SELECT id, email, role, two_factor_enabled, created_at, updated_at
     FROM users
     ORDER BY created_at ASC, id ASC`,
  ).all();
  return c.json({ users: users.map(publicUser) });
});

r.post("/users", async (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({})) as Partial<{ email: string; role: string }>;
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "valid email required" }, 400);
  const role = body.role === "admin" ? "admin" : "user";
  const existing = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existing) return c.json({ error: "user already exists" }, 409);
  const hash = await Bun.password.hash(temporaryDisabledPassword());
  const res = db.run(
    `INSERT INTO users (email, password_hash, role, two_factor_enabled, updated_at)
     VALUES (?, ?, ?, 0, datetime('now'))`,
    [email, hash, role],
  );
  const created = db.query<UserRow, [number]>(
    `SELECT id, email, role, two_factor_enabled, created_at, updated_at
     FROM users
     WHERE id = ?`,
  ).get(Number(res.lastInsertRowid));
  return c.json({ user: created ? publicUser(created) : null }, 201);
});

function temporaryDisabledPassword(): string {
  return randomBytes(32).toString("base64url");
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    two_factor_enabled: Boolean(user.two_factor_enabled),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export default r;
