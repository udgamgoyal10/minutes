import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db } from "../config/db.ts";
import { env } from "../config/env.ts";
import { isAdminRole, requireAuth } from "../middleware/auth.ts";
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
  section_key: string | null;
  created_at: string;
  owner_email?: string | null;
};

function canAccessMeeting(meetingId: number, user: { id: number; role: string }): boolean {
  if (isAdminRole(user.role)) {
    const row = db.query<{ id: number }, [number]>(
      "SELECT id FROM meetings WHERE id = ?",
    ).get(meetingId);
    return Boolean(row);
  }
  const row = db.query<{ id: number }, [number, number]>(
    "SELECT id FROM meetings WHERE id = ? AND user_id = ?",
  ).get(meetingId, user.id);
  return Boolean(row);
}

r.get("/meetings/:id/sources", (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  if (!canAccessMeeting(meetingId, user)) return c.json({ error: "not found" }, 404);
  const sectionKey = c.req.query("section_key");
  const select = isAdminRole(user.role)
    ? "SELECT s.*, u.email AS owner_email FROM sources s JOIN meetings m ON m.id = s.meeting_id JOIN users u ON u.id = m.user_id"
    : "SELECT s.* FROM sources s";
  if (sectionKey) {
    const draft = db.query<{ required_sources_json: string }, [number, string]>(
      "SELECT required_sources_json FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
    ).get(meetingId, sectionKey);
    const labels: string[] = draft
      ? (() => {
          try {
            const parsed = JSON.parse(draft.required_sources_json) as unknown;
            return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
          } catch {
            return [];
          }
        })()
      : [];
    const optionalLabel = `__section:${sectionKey}`;
    if (!labels.length) {
      const rows = db.query<SourceRow, [number, string, string]>(
        `${select} WHERE s.meeting_id = ? AND (s.section_key = ? OR (s.section_key IS NULL AND s.label = ?)) ORDER BY s.id ASC`,
      ).all(meetingId, sectionKey, optionalLabel);
      return c.json({ sources: rows });
    }
    const placeholders = labels.map(() => "?").join(",");
    const rows = db.query<SourceRow, (number | string)[]>(
      `${select} WHERE s.meeting_id = ? AND (s.section_key = ? OR (s.section_key IS NULL AND (s.label IN (${placeholders}) OR s.label = ?))) ORDER BY s.id ASC`,
    ).all(meetingId, sectionKey, ...labels, optionalLabel);
    return c.json({ sources: rows });
  }
  const rows = db.query<SourceRow, [number]>(
    `${select} WHERE s.meeting_id = ? ORDER BY s.id ASC`,
  ).all(meetingId);
  return c.json({ sources: rows });
});

r.post("/meetings/:id/sources", async (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  if (!canAccessMeeting(meetingId, user)) return c.json({ error: "not found" }, 404);

  const form = await c.req.parseBody({ all: true }).catch(() => null);
  if (!form) return c.json({ error: "invalid form" }, 400);

  const label = typeof form.label === "string" ? form.label : "";
  const sectionKey = typeof form.section_key === "string" ? form.section_key : null;
  const created: SourceRow[] = [];

  // 1) text paste
  const pastedText = typeof form.text === "string" ? form.text : "";
  if (pastedText.trim()) {
    const row = await insertText(meetingId, pastedText, label, sectionKey);
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
    const row = await insertFile(meetingId, f, label, sectionKey);
    created.push(row);
  }

  return c.json({ sources: created }, 201);
});

r.delete("/meetings/:id/sources/:sourceId", (c) => {
  const user = c.get("user");
  const meetingId = Number(c.req.param("id"));
  const sourceId = Number(c.req.param("sourceId"));
  if (!canAccessMeeting(meetingId, user)) return c.json({ error: "not found" }, 404);
  db.run("DELETE FROM sources WHERE id = ? AND meeting_id = ?", [sourceId, meetingId]);
  return c.json({ ok: true });
});

async function insertText(meetingId: number, text: string, label: string, sectionKey: string | null): Promise<SourceRow> {
  const res = db.run(
    `INSERT INTO sources (meeting_id, kind, label, section_key, extracted_text) VALUES (?, 'text', ?, ?, ?)`,
    [meetingId, label, sectionKey, text],
  );
  return db.query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(Number(res.lastInsertRowid))!;
}

async function insertFile(meetingId: number, file: File, label: string, sectionKey: string | null): Promise<SourceRow> {
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
    `INSERT INTO sources (meeting_id, kind, label, section_key, original_name, stored_path, mime, extracted_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [meetingId, kind, label, sectionKey, file.name, storedPath, file.type, extracted],
  );
  return db.query<SourceRow, [number]>("SELECT * FROM sources WHERE id = ?")
    .get(Number(res.lastInsertRowid))!;
}

export default r;
