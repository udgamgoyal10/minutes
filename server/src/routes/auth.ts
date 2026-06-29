import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { db } from "../config/db.ts";
import { env } from "../config/env.ts";
import { generateTotpSecret, totpQrDataUrl, verifyTotp } from "../services/totp.ts";

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  role: string;
  two_factor_secret: string | null;
  two_factor_enabled: number;
  google_sub: string | null;
};

type GoogleTokenInfo = {
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  error?: string;
};

type AuthPayload = {
  sub: number;
  email?: string;
  role?: string;
  typ?: string;
};

const r = new Hono();

r.post("/login", (c) => c.json({ error: "use google sign-in" }, 401));

r.post("/google", async (c) => {
  const body = await c.req.json().catch(() => null) as { credential?: string } | null;
  if (!body?.credential) return c.json({ error: "google credential required" }, 400);
  const google = await verifyGoogleCredential(body.credential);
  if (!google.ok) return c.json({ error: google.error }, google.status);
  const user = db.query<UserRow, [string]>("SELECT * FROM users WHERE lower(email) = ?").get(google.email);
  if (!user) return c.json({ error: "this Google account is not authorized" }, 403);
  if (user.google_sub && user.google_sub !== google.sub) return c.json({ error: "Google account mismatch" }, 403);
  if (!user.google_sub) {
    db.run("UPDATE users SET google_sub = ?, updated_at = datetime('now') WHERE id = ?", [google.sub, user.id]);
    user.google_sub = google.sub;
  }
  return c.json(await nextAuthStep(user));
});

r.post("/2fa/setup/verify", async (c) => {
  const body = await c.req.json().catch(() => null) as { setup_token?: string; code?: string } | null;
  if (!body?.setup_token || !body?.code) return c.json({ error: "setup token and code required" }, 400);
  const payload = await verifyAuthStep(body.setup_token, "2fa_setup");
  if (!payload) return c.json({ error: "invalid setup token" }, 401);
  const user = userById(payload.sub);
  if (!user?.two_factor_secret) return c.json({ error: "two factor setup not found" }, 400);
  if (!verifyTotp(user.two_factor_secret, body.code)) return c.json({ error: "invalid authenticator code" }, 401);
  db.run("UPDATE users SET two_factor_enabled = 1, updated_at = datetime('now') WHERE id = ?", [user.id]);
  return c.json(await issueTokens({ ...user, two_factor_enabled: 1 }));
});

r.post("/2fa/verify", async (c) => {
  const body = await c.req.json().catch(() => null) as { challenge_token?: string; code?: string } | null;
  if (!body?.challenge_token || !body?.code) return c.json({ error: "challenge token and code required" }, 400);
  const payload = await verifyAuthStep(body.challenge_token, "2fa_challenge");
  if (!payload) return c.json({ error: "invalid challenge token" }, 401);
  const user = userById(payload.sub);
  if (!user?.two_factor_secret || !user.two_factor_enabled) return c.json({ error: "two factor is not enabled" }, 400);
  if (!verifyTotp(user.two_factor_secret, body.code)) return c.json({ error: "invalid authenticator code" }, 401);
  return c.json(await issueTokens(user));
});

r.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => null) as { refresh_token?: string } | null;
  if (!body?.refresh_token) return c.json({ error: "refresh_token required" }, 400);
  try {
    const payload = (await verify(body.refresh_token, env.jwtSecret, "HS256")) as AuthPayload;
    if (payload.typ !== "refresh") return c.json({ error: "wrong token type" }, 401);
    const user = userById(payload.sub);
    if (!user) return c.json({ error: "invalid refresh token" }, 401);
    const tokens = await issueTokens(user);
    return c.json({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  } catch {
    return c.json({ error: "invalid refresh token" }, 401);
  }
});

function userById(id: number): UserRow | null {
  return db.query<UserRow, [number]>("SELECT * FROM users WHERE id = ?").get(id) ?? null;
}

async function nextAuthStep(user: UserRow) {
  if (!user.two_factor_enabled) {
    const secret = user.two_factor_secret || generateTotpSecret();
    if (!user.two_factor_secret) {
      db.run("UPDATE users SET two_factor_secret = ?, updated_at = datetime('now') WHERE id = ?", [secret, user.id]);
    }
    const setupToken = await signAuthStep(user, "2fa_setup");
    return {
      two_factor_setup_required: true,
      setup_token: setupToken,
      qr_data_url: await totpQrDataUrl(user.email, secret),
      manual_secret: secret,
      user: publicUser(user),
    };
  }
  const challengeToken = await signAuthStep(user, "2fa_challenge");
  return { two_factor_required: true, challenge_token: challengeToken, user: publicUser(user) };
}

async function signAuthStep(user: UserRow, typ: "2fa_setup" | "2fa_challenge"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, typ, iat: now, exp: now + 10 * 60 }, env.jwtSecret);
}

async function verifyAuthStep(token: string, typ: "2fa_setup" | "2fa_challenge"): Promise<AuthPayload | null> {
  try {
    const payload = (await verify(token, env.jwtSecret, "HS256")) as AuthPayload;
    if (payload.typ !== typ || typeof payload.sub !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

async function issueTokens(user: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const access = await sign(
    { sub: user.id, email: user.email, role: user.role, typ: "access", iat: now, exp: now + env.accessTtl },
    env.jwtSecret,
  );
  const refresh = await sign(
    { sub: user.id, email: user.email, role: user.role, typ: "refresh", iat: now, exp: now + env.refreshTtl },
    env.jwtSecret,
  );
  return { access_token: access, refresh_token: refresh, user: publicUser(user) };
}

async function verifyGoogleCredential(credential: string): Promise<
  | { ok: true; email: string; sub: string }
  | { ok: false; status: 400 | 401 | 500; error: string }
> {
  if (!env.googleClientId) return { ok: false, status: 500, error: "GOOGLE_CLIENT_ID is not configured" };
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) return { ok: false, status: 401, error: "invalid Google credential" };
  const info = (await res.json().catch(() => ({}))) as GoogleTokenInfo;
  if (info.error) return { ok: false, status: 401, error: "invalid Google credential" };
  if (info.aud !== env.googleClientId) return { ok: false, status: 401, error: "Google credential audience mismatch" };
  if (!info.sub) return { ok: false, status: 401, error: "Google credential missing subject" };
  const email = info.email?.trim().toLowerCase() ?? "";
  if (!email) return { ok: false, status: 401, error: "Google credential missing email" };
  if (!(info.email_verified === true || info.email_verified === "true")) {
    return { ok: false, status: 401, error: "Google email is not verified" };
  }
  return { ok: true, email, sub: info.sub };
}

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, role: user.role };
}

export default r;
