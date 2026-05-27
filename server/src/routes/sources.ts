import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db } from "../config/db.ts";
import { env } from "../config/env.ts";
import { requireAuth } from "../middleware/auth.ts";
import { extract, kindFromMime, type SourceKind } from "../services/extractors/index.ts";

const r = new Hono();
r.use("*", requireAuth);

type SourceRow = {
  id: number;
  meeting_id: number;
  kind: SourceKind;
  label: string | null;
  original_name: string | null;
  stored_path: string | null;
  mime: string | null;
  extracted_text: string | null;
  created_at: string;
};

function ensureOwnedMeeting(meetingId: number, userId: number): boolean {
  const row = db.query<{ id: number }, [number, number]>(
    "SELECT id FROM meetings WHERE id = ? AND user_id = ?",
  ).get(meetingId, userId);
  return Boolean(row);
}

r.get("/meetings/:id/sources", (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  if (!ensureOwnedMeeting(meetingId, user.id)) return c.json({ error: "not found" }, 404);
  const rows = db.query<SourceRow, [number]>(
    "SELECT * FROM sources WHERE meeting_id = ? ORDER BY id ASC",
  ).all(meetingId);
  return c.json({ sources: rows });
});

r.post("/meetings/:id/sources", async (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  if (!ensureOwnedMeeting(meetingId, user.id)) return c.json({ error: "not found" }, 404);

  const form = await c.req.parseBody({ all: true }).catch(() => null);
  if (!form) return c.json({ error: "invalid form" }, 400);

  const label = typeof form.label === "string" ? form.label : "";
  const created: SourceRow[] = [];

  // 1) text paste
  const pastedText = typeof form.text === "string" ? form.text : "";
  if (pastedText.trim()) {
    const row = await insertText(meetingId, pastedText, label);
    created.push(row);
  }

  // 2) files (multiple under "files" key)
  const filesField = form.files as unknown;
  const files: File[] = Array.isArray(filesField)
    ? (filesField as File[])
    : filesField instanceof File
      ? [filesField]
      : [];

  for (const f of files) {
    const row = await insertFile(meetingId, f, label);
    created.push(row);
  }

  return c.json({ sources: created }, 201);
});

r.delete("/meetings/:id/sources/:sourceId", (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  const sourceId = Number(c.req.param("sourceId"));
  if (!ensureOwnedMeeting(meetingId, user.id)) return c.json({ error: "not found" }, 404);
  db.run("DELETE FROM sources WHERE id = ? AND meeting_id = ?", [sourceId, meetingId]);
  return c.json({ ok: true });
});

async function insertText(meetingId: number, text: string, label: string): Promise<SourceRow> {
  const res = db.run(
    `INSERT INTO sources (meeting_id, kind, label, extracted_text) VALUES (?, 'text', ?, ?)`,
    [meetingId, label, text],
  );
  return db.query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(Number(res.lastInsertRowid))!;
}

async function insertFile(meetingId: number, file: File, label: string): Promise<SourceRow> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  const uploadRoot = resolve(process.cwd(), env.uploadDir, String(meetingId));
  await mkdir(uploadRoot, { recursive: true });
  const storedPath = join(uploadRoot, `${Date.now()}-${safeName}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await Bun.write(storedPath, bytes);

  const kind = kindFromMime(file.name, file.type);
  let extracted = "";
  try {
    extracted = await extract(kind, storedPath, file.type);
  } catch (err) {
    extracted = `[extractor error: ${(err as Error).message}]`;
  }

  const res = db.run(
    `INSERT INTO sources (meeting_id, kind, label, original_name, stored_path, mime, extracted_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [meetingId, kind, label, file.name, storedPath, file.type, extracted],
  );
  return db.query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(Number(res.lastInsertRowid))!;
}

export default r;
