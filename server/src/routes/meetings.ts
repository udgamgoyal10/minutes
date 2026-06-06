import { Hono } from "hono";
import { db } from "../config/db.ts";
import { requireAuth } from "../middleware/auth.ts";
import { inferRequiredSources } from "../services/source-recommendations.ts";
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

type CustomTemplateRow = {
  id: number;
  user_id: number;
  key: string;
  title: string;
  body_text: string;
  required_sources_json: string;
  created_at: string;
};

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function customToSection(row: CustomTemplateRow) {
  return {
    key: row.key,
    title: row.title,
    body_text: row.body_text,
    placeholders: [] as { token: string; raw: string }[],
    required_sources: parseStringArray(row.required_sources_json),
    template_id: -1,
    template_slug: "custom",
    template_title: "My templates",
    custom_id: row.id,
  };
}

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

r.get("/section-templates", (c) => {
  const user = c.get("user");
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  const seen = new Set<string>();
  const sections: Array<{
    key: string;
    title: string;
    body_text: string;
    placeholders: { token: string; raw: string }[];
    required_sources: string[];
    template_id: number;
    template_slug: string;
    template_title: string;
    custom_id?: number;
  }> = [];

  // User-saved custom templates first, so they are easy to find.
  const customRows = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, created_at FROM custom_section_templates WHERE user_id = ? ORDER BY created_at DESC",
  ).all(user.id);
  for (const row of customRows) {
    seen.add(normalizeSectionTitle(row.title));
    sections.push({
      key: row.key,
      title: row.title,
      body_text: row.body_text,
      placeholders: [],
      required_sources: parseStringArray(row.required_sources_json),
      template_id: -1,
      template_slug: "custom",
      template_title: "My templates",
      custom_id: row.id,
    });
  }

  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    for (const section of parsed.sections) {
      // Normalize titles (drops "the", punctuation, casing) so near-identical
      // sections like "Maintenance of Agricultural Fields" and "Maintenance of
      // the Agricultural Fields" collapse to a single catalog entry.
      const dedupeKey = normalizeSectionTitle(section.title);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      sections.push({
        key: section.key,
        title: section.title,
        body_text: section.bodyText,
        placeholders: section.placeholders,
        required_sources: inferRequiredSources(section.title, section.bodyText),
        template_id: row.id,
        template_slug: row.slug,
        template_title: row.title,
      });
    }
  }
  return c.json({ sections });
});

r.post("/section-templates", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
  }>;
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);
  const key = normalizeSectionTitle(title) || `custom-${Date.now()}`;
  const required = Array.isArray(body.required_sources)
    ? body.required_sources.filter((x): x is string => typeof x === "string")
    : [];
  const res = db.run(
    `INSERT INTO custom_section_templates (user_id, key, title, body_text, required_sources_json)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, key, title, body.body_text ?? "", JSON.stringify(required)],
  );
  const row = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, created_at FROM custom_section_templates WHERE id = ?",
  ).get(Number(res.lastInsertRowid));
  return c.json({ template: row ? customToSection(row) : null }, 201);
});

r.patch("/section-templates/custom/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const existing = db.query<CustomTemplateRow, [number, number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, created_at FROM custom_section_templates WHERE id = ? AND user_id = ?",
  ).get(id, user.id);
  if (!existing) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
  }>;
  const title = body.title?.trim() || existing.title;
  const key = normalizeSectionTitle(title) || existing.key;
  const required = Array.isArray(body.required_sources)
    ? body.required_sources.filter((x): x is string => typeof x === "string")
    : parseStringArray(existing.required_sources_json);
  db.run(
    `UPDATE custom_section_templates
     SET title = ?, key = ?, body_text = ?, required_sources_json = ?
     WHERE id = ? AND user_id = ?`,
    [title, key, body.body_text ?? existing.body_text, JSON.stringify(required), id, user.id],
  );
  const row = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, created_at FROM custom_section_templates WHERE id = ?",
  ).get(id);
  return c.json({ template: row ? customToSection(row) : null });
});

r.delete("/section-templates/custom/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  db.run("DELETE FROM custom_section_templates WHERE id = ? AND user_id = ?", [id, user.id]);
  return c.json({ ok: true });
});

type VariableValueRow = { token: string; value: string };

r.get("/variable-values", (c) => {
  const user = c.get("user");
  const rows = db.query<VariableValueRow, [number]>(
    "SELECT token, value FROM template_variable_values WHERE user_id = ? ORDER BY value COLLATE NOCASE ASC",
  ).all(user.id);
  const values: Record<string, string[]> = {};
  for (const row of rows) {
    (values[row.token] ??= []).push(row.value);
  }
  return c.json({ values });
});

r.post("/variable-values", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{
    entries: Array<{ token: string; value: string }>;
    token: string;
    value: string;
  }>;
  const entries = body.entries ?? (body.token ? [{ token: body.token, value: body.value ?? "" }] : []);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO template_variable_values (user_id, token, value) VALUES (?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const e of entries) {
      const token = typeof e.token === "string" ? e.token.trim() : "";
      const value = typeof e.value === "string" ? e.value.trim() : "";
      if (token && value) insert.run(user.id, token, value);
    }
  });
  tx();
  const rows = db.query<VariableValueRow, [number]>(
    "SELECT token, value FROM template_variable_values WHERE user_id = ? ORDER BY value COLLATE NOCASE ASC",
  ).all(user.id);
  const values: Record<string, string[]> = {};
  for (const row of rows) {
    (values[row.token] ??= []).push(row.value);
  }
  return c.json({ values });
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
    `INSERT INTO section_drafts (meeting_id, section_key, ordinal, title, content_md, status, mode, required_sources_json)
     VALUES (?, ?, ?, ?, ?, 'pending', 'template', ?)`,
  );
  const tx = db.transaction(() => {
    for (const s of parsed.sections) {
      insertSec.run(
        meetingId,
        s.key,
        s.ordinal,
        s.title,
        s.bodyText,
        JSON.stringify(inferRequiredSources(s.title, s.bodyText)),
      );
    }
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

function normalizeSectionTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
