import { Hono } from "hono";
import { db } from "../config/db.ts";
import { requireAuth } from "../middleware/auth.ts";
import { generate, type ProviderId } from "../services/ai/index.ts";
import { buildPrompt, type PromptContext } from "../services/prompts/index.ts";
import { inferRequiredSources } from "../services/source-recommendations.ts";
import type { ParsedSection, ParsedTemplate } from "../services/template-parser.ts";
import { buildTemplateVariables, fillTemplateText, slugifyVariable } from "../services/template-variables.ts";

const r = new Hono();
r.use("*", requireAuth);

type SectionRow = {
  id: number;
  meeting_id: number;
  section_key: string;
  ordinal: number;
  title: string;
  content_md: string;
  template_body_text: string;
  status: string;
  mode: string;
  required_sources_json: string;
  last_ai_provider: string | null;
  last_ai_model: string | null;
  updated_at: string;
};

type MeetingCtxRow = {
  id: number;
  template_id: number;
  user_id: number;
  variables_json: string;
  meeting_date: string | null;
  previous_meeting_date: string | null;
  label: string;
  ai_provider: string | null;
  ai_model: string | null;
  parsed_json: string;
  org_name: string;
};

function loadMeetingCtx(meetingId: number, userId: number): MeetingCtxRow | null {
  return db.query<MeetingCtxRow, [number, number]>(
    `SELECT m.id, m.template_id, m.user_id, m.variables_json, m.meeting_date,
            m.previous_meeting_date, m.label, m.ai_provider, m.ai_model,
            t.parsed_json, o.name AS org_name
     FROM meetings m
     JOIN meeting_templates t ON t.id = m.template_id
     JOIN organizations o ON o.id = t.organization_id
     WHERE m.id = ? AND m.user_id = ?`,
  ).get(meetingId, userId) ?? null;
}

function parseSourcesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToSection(row: SectionRow, variables?: Record<string, string>) {
  return {
    id: row.id,
    meeting_id: row.meeting_id,
    section_key: row.section_key,
    ordinal: row.ordinal,
    title: row.title,
    content_md: row.content_md,
    template_body_text: row.template_body_text ?? "",
    preview_md: variables ? fillTemplateText(row.content_md, variables) : row.content_md,
    template_preview_md: variables
      ? fillTemplateText(row.template_body_text ?? "", variables)
      : (row.template_body_text ?? ""),
    status: row.status,
    mode: row.mode === "ai" ? "ai" : "template",
    required_sources: parseSourcesJson(row.required_sources_json),
    last_ai_provider: row.last_ai_provider,
    last_ai_model: row.last_ai_model,
    updated_at: row.updated_at,
  };
}

function slugify(s: string): string {
  return slugifyVariable(s);
}

function variablesForMeeting(m: MeetingCtxRow): Record<string, string> {
  return buildTemplateVariables({
    variables: JSON.parse(m.variables_json) as Record<string, string>,
    meetingDate: m.meeting_date,
    previousMeetingDate: m.previous_meeting_date,
  });
}

function uniqueSectionKey(meetingId: number, title: string): string {
  const base = slugify(title) || "section";
  let key = base;
  let n = 2;
  while (db.query<{ id: number }, [number, string]>(
    "SELECT id FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(meetingId, key)) {
    key = `${base}-${n}`;
    n += 1;
  }
  return key;
}

r.get("/meetings/:id/sections", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const rows = db.query<SectionRow, [number]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
  ).all(id);
  const variables = variablesForMeeting(m);
  return c.json({ sections: rows.map((row) => rowToSection(row, variables)) });
});

r.post("/meetings/:id/sections", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    mode: "template" | "ai";
    content_md: string;
    template_body_text: string;
    required_sources: string[];
  }>;
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);

  const max = db.query<{ ordinal: number }, [number]>(
    "SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM section_drafts WHERE meeting_id = ?",
  ).get(id)?.ordinal ?? 0;
  const key = uniqueSectionKey(id, title);
  const templateBody = body.template_body_text ?? body.content_md ?? "";
  const contentMd = body.content_md ?? templateBody;
  const required = body.required_sources ?? inferRequiredSources(title, contentMd);
  const res = db.run(
    `INSERT INTO section_drafts
       (meeting_id, section_key, ordinal, title, content_md, template_body_text, status, mode, required_sources_json)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, key, max + 1, title, contentMd, templateBody, body.mode === "ai" ? "ai" : "template", JSON.stringify(required)],
  );
  const row = db.query<SectionRow, [number]>("SELECT * FROM section_drafts WHERE id = ?")
    .get(Number(res.lastInsertRowid));
  return c.json({ section: row ? rowToSection(row, variablesForMeeting(m)) : null }, 201);
});

r.patch("/meetings/:id/sections/reorder", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{ section_keys: string[] }>;
  const keys = body.section_keys?.filter((k): k is string => typeof k === "string" && k.length > 0) ?? [];
  if (!keys.length) return c.json({ error: "section_keys required" }, 400);
  const update = db.prepare("UPDATE section_drafts SET ordinal = ?, updated_at = datetime('now') WHERE meeting_id = ? AND section_key = ?");
  const tx = db.transaction(() => {
    keys.forEach((key, idx) => update.run(idx + 1, id, key));
  });
  tx();
  const rows = db.query<SectionRow, [number]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
  ).all(id);
  const variables = variablesForMeeting(m);
  return c.json({ sections: rows.map((row) => rowToSection(row, variables)) });
});

r.patch("/meetings/:id/sections/:key", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    content_md: string;
    status: "pending" | "draft" | "approved";
    mode: "template" | "ai";
    required_sources: string[];
  }>;
  db.run(
    `UPDATE section_drafts
     SET title = COALESCE(?, title),
         content_md = COALESCE(?, content_md),
         status = COALESCE(?, status),
         mode = COALESCE(?, mode),
         required_sources_json = COALESCE(?, required_sources_json),
         updated_at = datetime('now')
     WHERE meeting_id = ? AND section_key = ?`,
    [
      body.title?.trim() || null,
      body.content_md ?? null,
      body.status ?? null,
      body.mode ?? null,
      body.required_sources ? JSON.stringify(body.required_sources) : null,
      id,
      key,
    ],
  );
  const row = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!row) return c.json({ error: "section not found" }, 404);
  return c.json({ section: rowToSection(row, variablesForMeeting(m)) });
});

r.delete("/meetings/:id/sections/:key", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  db.run("DELETE FROM section_drafts WHERE meeting_id = ? AND section_key = ?", [id, key]);
  const rows = db.query<SectionRow, [number]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
  ).all(id);
  const update = db.prepare("UPDATE section_drafts SET ordinal = ? WHERE meeting_id = ? AND section_key = ?");
  const tx = db.transaction(() => {
    rows.forEach((row, idx) => update.run(idx + 1, id, row.section_key));
  });
  tx();
  return c.json({ ok: true });
});

r.post("/meetings/:id/sections/:key/revert", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);
  const fallback = draft.template_body_text || draft.content_md;
  db.run(
    `UPDATE section_drafts
     SET content_md = ?, status = 'pending', mode = 'template',
         last_ai_provider = NULL, last_ai_model = NULL,
         updated_at = datetime('now')
     WHERE meeting_id = ? AND section_key = ?`,
    [fallback, id, key],
  );
  const row = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  return c.json({ section: row ? rowToSection(row, variablesForMeeting(m)) : null });
});

function buildSectionPrompt(
  m: MeetingCtxRow,
  draft: SectionRow,
  sourceIds?: number[],
): { system: string; prompt: string } {
  const id = m.id;
  const parsed = JSON.parse(m.parsed_json) as ParsedTemplate;
  const templateSection = parsed.sections.find((s) => s.key === draft.section_key);
  const section: ParsedSection = templateSection ?? {
    key: draft.section_key,
    ordinal: draft.ordinal,
    title: draft.title,
    bodyText: draft.content_md,
    bodyXml: "",
    placeholders: [],
  };

  // Pull sources scoped to this section's required source labels
  const requiredLabels = parseSourcesJson(draft.required_sources_json);
  let sourceRows: Array<{ id: number; kind: string; label: string | null; extracted_text: string | null }> = [];
  if (sourceIds && sourceIds.length) {
    const placeholders = sourceIds.map(() => "?").join(",");
    sourceRows = db.query<typeof sourceRows[number], number[]>(
      `SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND id IN (${placeholders})`,
    ).all(id, ...sourceIds) as typeof sourceRows;
  } else if (requiredLabels.length) {
    const placeholders = requiredLabels.map(() => "?").join(",");
    sourceRows = db.query<typeof sourceRows[number], (number | string)[]>(
      `SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND label IN (${placeholders})`,
    ).all(id, ...requiredLabels) as typeof sourceRows;
  }

  const sectionMode: "template" | "ai" = draft.mode === "ai" ? "ai" : "template";
  const ctx: PromptContext = {
    organizationName: m.org_name,
    meetingTitle: m.label,
    meetingDate: m.meeting_date ?? "",
    previousMeetingDate: m.previous_meeting_date ?? "",
    variables: variablesForMeeting(m),
    section,
    templateBodyText: draft.template_body_text || section.bodyText,
    mode: sectionMode,
    sources: sourceRows.map((s) => ({
      label: s.label ?? "",
      kind: s.kind,
      text: (s.extracted_text ?? "").slice(0, 40000),
    })),
  };
  return buildPrompt(ctx);
}

r.get("/meetings/:id/sections/:key/prompt", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);
  const { system, prompt } = buildSectionPrompt(m, draft);
  return c.json({ system, prompt });
});

r.post("/meetings/:id/sections/:key/generate", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<{
    provider: ProviderId;
    model: string;
    user_prompt: string; // optional refinement instruction layered on top
    prompt_override: string; // full prompt the user edited in the UI
    source_ids: number[]; // optional whitelist
  }>;

  const provider = (body.provider || m.ai_provider || "ollama") as ProviderId;
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);

  const { system, prompt: basePrompt } = buildSectionPrompt(m, draft, body.source_ids);
  const override = body.prompt_override?.trim();
  const userInstruction = body.user_prompt?.trim();
  const prompt = override
    ? override
    : userInstruction
      ? `${basePrompt}\n\nAdditional instruction:\n${userInstruction}`
      : basePrompt;

  const started = Date.now();
  try {
    const result = await generate({ provider, model: body.model, system, prompt });
    const duration = Date.now() - started;
    db.run(
      `INSERT INTO ai_runs (meeting_id, section_key, provider, model, prompt, response, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, key, result.provider, result.model, prompt, result.text, duration],
    );
    db.run(
      `UPDATE section_drafts
       SET content_md = ?, status = 'draft',
           last_ai_provider = ?, last_ai_model = ?,
           updated_at = datetime('now')
       WHERE meeting_id = ? AND section_key = ?`,
      [result.text, result.provider, result.model, id, key],
    );
    const row = db.query<SectionRow, [number, string]>(
      "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
    ).get(id, key);
    return c.json({
      section: row ? rowToSection(row, variablesForMeeting(m)) : null,
      ai: { provider: result.provider, model: result.model, duration_ms: duration },
    });
  } catch (err) {
    db.run(
      `INSERT INTO ai_runs (meeting_id, section_key, provider, model, prompt, error, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, key, provider, body.model ?? "", prompt, (err as Error).message, Date.now() - started],
    );
    return c.json({ error: (err as Error).message }, 502);
  }
});

export default r;
