import type { Context, Next } from "hono";
import { verify } from "hono/jwt";
import { env } from "../config/env.ts";

export type AuthUser = { id: number; email: string; role: string };

export function isAdminRole(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return c.json({ error: "missing token" }, 401);
  try {
    const payload = (await verify(token, env.jwtSecret, "HS256")) as {
      sub: number;
      email: string;
      role: string;
      typ?: string;
    };
    if (payload.typ && payload.typ !== "access") {
      return c.json({ error: "wrong token type" }, 401);
    }
    c.set("user", { id: payload.sub, email: payload.email, role: payload.role });
    await next();
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }
}
