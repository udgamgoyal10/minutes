import { Hono } from "hono";
import { db } from "../config/db.ts";
import { requireAuth } from "../middleware/auth.ts";
import type { ParsedTemplate } from "../services/template-parser.ts";

const r = new Hono();
r.use("*", requireAuth);

type OrgRow = { id: number; slug: string; name: string };
type TemplateRow = {
  id: number;
  organization_id: number;
  slug: string;
  title: string;
  docx_path: string;
  parsed_json: string;
};
type MeetingRow = {
  id: number;
  template_id: number;
  user_id: number;
  label: string;
  meeting_date: string | null;
  previous_meeting_date: string | null;
  variables_json: string;
  ai_provider: string | null;
  ai_model: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

r.get("/organizations", (c) => {
  const rows = db.query<OrgRow, []>("SELECT id, slug, name FROM organizations ORDER BY name").all();
  return c.json({ organizations: rows });
});

r.get("/templates", (c) => {
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  return c.json({
    templates: rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      slug: row.slug,
      title: row.title,
      parsed: JSON.parse(row.parsed_json) as ParsedTemplate,
    })),
  });
});

r.get("/meetings", (c) => {
  const user = c.get("user");
  const rows = db.query<MeetingRow, [number]>(
    "SELECT * FROM meetings WHERE user_id = ? ORDER BY updated_at DESC",
  ).all(user.id);
  return c.json({ meetings: rows.map(rowToMeeting) });
});

r.post("/meetings", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null) as
    | { template_id?: number; label?: string }
    | null;
  if (!body?.template_id) return c.json({ error: "template_id required" }, 400);
  const tpl = db.query<TemplateRow, [number]>("SELECT * FROM meeting_templates WHERE id = ?")
    .get(body.template_id);
  if (!tpl) return c.json({ error: "template not found" }, 404);
  const label = body.label?.trim() || `${tpl.title} — ${new Date().toLocaleDateString()}`;

  const res = db.run(
    `INSERT INTO meetings (template_id, user_id, label, variables_json) VALUES (?, ?, ?, '{}')`,
    [tpl.id, user.id, label],
  );
  const meetingId = Number(res.lastInsertRowid);

  // Seed empty section_drafts so the UI has rows to render
  const parsed = JSON.parse(tpl.parsed_json) as ParsedTemplate;
  const insertSec = db.prepare(
    `INSERT INTO section_drafts (meeting_id, section_key, ordinal, title, content_md, status)
     VALUES (?, ?, ?, ?, '', 'pending')`,
  );
  const tx = db.transaction(() => {
    for (const s of parsed.sections) insertSec.run(meetingId, s.key, s.ordinal, s.title);
  });
  tx();

  const meeting = db.query<MeetingRow, [number]>("SELECT * FROM meetings WHERE id = ?")
    .get(meetingId);
  return c.json({ meeting: meeting ? rowToMeeting(meeting) : null }, 201);
});

r.get("/meetings/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = getMeeting(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  return c.json({ meeting: m });
});

r.patch("/meetings/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = getMeetingRow(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    label: string;
    meeting_date: string;
    previous_meeting_date: string;
    variables: Record<string, string>;
    ai_provider: string;
    ai_model: string;
    status: string;
  }>;
  const vars = body.variables
    ? JSON.stringify({ ...(JSON.parse(m.variables_json) as Record<string, string>), ...body.variables })
    : m.variables_json;
  db.run(
    `UPDATE meetings SET
      label = COALESCE(?, label),
      meeting_date = COALESCE(?, meeting_date),
      previous_meeting_date = COALESCE(?, previous_meeting_date),
      variables_json = ?,
      ai_provider = COALESCE(?, ai_provider),
      ai_model = COALESCE(?, ai_model),
      status = COALESCE(?, status),
      updated_at = datetime('now')
     WHERE id = ?`,
    [
      body.label ?? null,
      body.meeting_date ?? null,
      body.previous_meeting_date ?? null,
      vars,
      body.ai_provider ?? null,
      body.ai_model ?? null,
      body.status ?? null,
      id,
    ],
  );
  return c.json({ meeting: getMeeting(id, user.id) });
});

r.delete("/meetings/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM meetings WHERE id = ? AND user_id = ?", [id, user.id]);
  return c.json({ ok: true });
});

function getMeetingRow(id: number, userId: number): MeetingRow | null {
  return db.query<MeetingRow, [number, number]>(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?",
  ).get(id, userId) ?? null;
}

function getMeeting(id: number, userId: number) {
  const row = getMeetingRow(id, userId);
  return row ? rowToMeeting(row) : null;
}

function rowToMeeting(row: MeetingRow) {
  return {
    id: row.id,
    template_id: row.template_id,
    label: row.label,
    meeting_date: row.meeting_date,
    previous_meeting_date: row.previous_meeting_date,
    variables: JSON.parse(row.variables_json) as Record<string, string>,
    ai_provider: row.ai_provider,
    ai_model: row.ai_model,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default r;
