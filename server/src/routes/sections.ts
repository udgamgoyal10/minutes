import { Hono } from "hono";
import { db } from "../config/db.ts";
import { isAdminRole, requireAuth } from "../middleware/auth.ts";
import { generate, type ProviderId } from "../services/ai/index.ts";
import { buildPrompt, type PromptContext } from "../services/prompts/index.ts";
import { inferRequiredSources } from "../services/source-recommendations.ts";
import type { ParsedSection, ParsedTemplate } from "../services/template-parser.ts";
import { buildTemplateVariables, fillTemplateText, inferRequiredVariables, slugifyVariable } from "../services/template-variables.ts";
import { exampleFilePath, exampleSourcesFor } from "../services/example-sources.ts";
import { existsSync } from "node:fs";

const r = new Hono();
r.use("*", requireAuth);

// Static, sanitized example source files for a section (download references).
r.get("/sections/:key/examples", (c) => {
  const key = c.req.param("key");
  const examples = exampleSourcesFor(key).map((e) => ({
    label: e.label,
    file: e.file,
    download_url: `/api/example-sources/download?file=${encodeURIComponent(e.file)}`,
  }));
  return c.json({ examples });
});

r.get("/example-sources/download", (c) => {
  const file = c.req.query("file") ?? "";
  const path = exampleFilePath(file);
  if (!path || !existsSync(path)) return c.json({ error: "not found" }, 404);
  return new Response(Bun.file(path), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${file.replace(/[^A-Za-z0-9._ ()-]+/g, "_")}"`,
    },
  });
});

type MappingRow = { token: string };

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
  required_variables_json: string | null;
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

type SectionPromptOverrideRow = {
  prompt: string;
};

function loadMeetingCtx(meetingId: number, user: { id: number; role: string }): MeetingCtxRow | null {
  if (isAdminRole(user.role)) {
    return db.query<MeetingCtxRow, [number]>(
      `SELECT m.id, m.template_id, m.user_id, m.variables_json, m.meeting_date,
              m.previous_meeting_date, m.label, m.ai_provider, m.ai_model,
              t.parsed_json, o.name AS org_name
       FROM meetings m
       JOIN meeting_templates t ON t.id = m.template_id
       JOIN organizations o ON o.id = t.organization_id
       WHERE m.id = ?`,
    ).get(meetingId) ?? null;
  }
  return db.query<MeetingCtxRow, [number, number]>(
    `SELECT m.id, m.template_id, m.user_id, m.variables_json, m.meeting_date,
            m.previous_meeting_date, m.label, m.ai_provider, m.ai_model,
            t.parsed_json, o.name AS org_name
     FROM meetings m
     JOIN meeting_templates t ON t.id = m.template_id
     JOIN organizations o ON o.id = t.organization_id
     WHERE m.id = ? AND m.user_id = ?`,
  ).get(meetingId, user.id) ?? null;
}

function sectionPromptOverride(userId: number, meetingId: number, sectionKey: string): string | null {
  return db.query<SectionPromptOverrideRow, [number, number, string]>(
    "SELECT prompt FROM section_prompt_overrides WHERE user_id = ? AND meeting_id = ? AND section_key = ?",
  ).get(userId, meetingId, sectionKey)?.prompt ?? null;
}

function userMappedVariables(userId: number | undefined, sectionKey: string): string[] {
  if (!userId) return [];
  return db.query<MappingRow, [number, string]>(
    "SELECT token FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ? ORDER BY token",
  ).all(userId, sectionKey).map((row) => row.token);
}

function userExcludedVariables(userId: number | undefined, sectionKey: string): Set<string> {
  if (!userId) return new Set();
  return new Set(db.query<MappingRow, [number, string]>(
    "SELECT token FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?",
  ).all(userId, sectionKey).map((row) => row.token));
}

function effectiveRequiredVariables(userId: number | undefined, sectionKey: string, base: string[]): string[] {
  const excluded = userExcludedVariables(userId, sectionKey);
  return mergeVariables(base, userMappedVariables(userId, sectionKey)).filter((token) => !excluded.has(token));
}

function parseSourcesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToSection(row: SectionRow, variables?: Record<string, string>, userId?: number) {
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
    required_variables: effectiveRequiredVariables(
      userId,
      row.section_key,
      mergeVariables(
        inferRequiredVariables(row.template_body_text ?? "", row.title),
        parseSourcesJson(row.required_variables_json ?? "[]"),
      ),
    ),
    last_ai_provider: row.last_ai_provider,
    last_ai_model: row.last_ai_model,
    updated_at: row.updated_at,
  };
}

function mergeVariables(...lists: string[][]): string[] {
  const out = new Set<string>();
  for (const list of lists) for (const v of list) out.add(v);
  return [...out];
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
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const rows = db.query<SectionRow, [number]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
  ).all(id);
  const variables = variablesForMeeting(m);
  return c.json({ sections: rows.map((row) => rowToSection(row, variables, user.id)) });
});

r.post("/meetings/:id/sections", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    mode: "template" | "ai";
    content_md: string;
    template_body_text: string;
    required_sources: string[];
    required_variables: string[];
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
  const requiredVars = Array.isArray(body.required_variables)
    ? body.required_variables.filter((x): x is string => typeof x === "string")
    : inferRequiredVariables(templateBody, title);
  const res = db.run(
    `INSERT INTO section_drafts
       (meeting_id, section_key, ordinal, title, content_md, template_body_text, status, mode, required_sources_json, required_variables_json)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, key, max + 1, title, contentMd, templateBody, body.mode === "ai" ? "ai" : "template", JSON.stringify(required), JSON.stringify(requiredVars)],
  );
  const row = db.query<SectionRow, [number]>("SELECT * FROM section_drafts WHERE id = ?")
    .get(Number(res.lastInsertRowid));
  return c.json({ section: row ? rowToSection(row, variablesForMeeting(m), user.id) : null }, 201);
});

r.patch("/meetings/:id/sections/reorder", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user);
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
  return c.json({ sections: rows.map((row) => rowToSection(row, variables, user.id)) });
});

r.patch("/meetings/:id/sections/:key", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    content_md: string;
    status: "pending" | "draft" | "approved";
    mode: "template" | "ai";
    required_sources: string[];
    required_variables: string[];
  }>;
  db.run(
    `UPDATE section_drafts
     SET title = COALESCE(?, title),
         content_md = COALESCE(?, content_md),
         status = COALESCE(?, status),
         mode = COALESCE(?, mode),
         required_sources_json = COALESCE(?, required_sources_json),
         required_variables_json = COALESCE(?, required_variables_json),
         updated_at = datetime('now')
     WHERE meeting_id = ? AND section_key = ?`,
    [
      body.title?.trim() || null,
      body.content_md ?? null,
      body.status ?? null,
      body.mode ?? null,
      body.required_sources ? JSON.stringify(body.required_sources) : null,
      body.required_variables ? JSON.stringify(body.required_variables) : null,
      id,
      key,
    ],
  );
  const row = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!row) return c.json({ error: "section not found" }, 404);
  return c.json({ section: rowToSection(row, variablesForMeeting(m), user.id) });
});

r.delete("/meetings/:id/sections/:key", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
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
  const m = loadMeetingCtx(id, user);
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
  return c.json({ section: row ? rowToSection(row, variablesForMeeting(m), user.id) : null });
});

function sectionForDraft(m: MeetingCtxRow, draft: SectionRow): ParsedSection {
  const parsed = JSON.parse(m.parsed_json) as ParsedTemplate;
  const templateSection = parsed.sections.find((s) => s.key === draft.section_key);
  return templateSection ?? {
    key: draft.section_key,
    ordinal: draft.ordinal,
    title: draft.title,
    bodyText: draft.content_md,
    bodyXml: "",
    placeholders: [],
  };
}

function sourceRowsForSection(
  meetingId: number,
  draft: SectionRow,
  sourceIds?: number[],
): Array<{ id: number; kind: string; label: string | null; extracted_text: string | null }> {
  const requiredLabels = parseSourcesJson(draft.required_sources_json);
  let sourceRows: Array<{ id: number; kind: string; label: string | null; extracted_text: string | null }> = [];
  if (sourceIds && sourceIds.length) {
    const placeholders = sourceIds.map(() => "?").join(",");
    sourceRows = db.query<typeof sourceRows[number], number[]>(
      `SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND id IN (${placeholders})`,
    ).all(meetingId, ...sourceIds) as typeof sourceRows;
  } else if (requiredLabels.length) {
    const placeholders = requiredLabels.map(() => "?").join(",");
    sourceRows = db.query<typeof sourceRows[number], (number | string)[]>(
      `SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND label IN (${placeholders})`,
    ).all(meetingId, ...requiredLabels) as typeof sourceRows;
  } else {
    sourceRows = db.query<typeof sourceRows[number], [number, string]>(
      "SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND label = ?",
    ).all(meetingId, `__section:${draft.section_key}`) as typeof sourceRows;
  }
  return sourceRows;
}

function promptSourcesBlock(sourceRows: Array<{ kind: string; label: string | null; extracted_text: string | null }>): string {
  if (!sourceRows.length) return "Sources: (none provided)";
  return `Sources:\n${sourceRows.map((s, i) => (
    `--- source ${i + 1} [${s.kind}] ${s.label || ""} ---\n${(s.extracted_text ?? "").slice(0, 40000)}`
  )).join("\n\n")}`;
}

function sourceLikeUserPrompt(text: string): boolean {
  return text.length > 700 || text.split(/\r?\n/).filter((line) => line.trim()).length >= 6;
}

function buildSectionPrompt(
  m: MeetingCtxRow,
  draft: SectionRow,
  sourceIds?: number[],
): { system: string; prompt: string; sources: string } {
  const section = sectionForDraft(m, draft);
  const sourceRows = sourceRowsForSection(m.id, draft, sourceIds);

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
  return { ...buildPrompt(ctx), sources: promptSourcesBlock(sourceRows) };
}

r.get("/meetings/:id/sections/:key/prompt", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);
  const { system, prompt } = buildSectionPrompt(m, draft);
  const saved_prompt = sectionPromptOverride(user.id, id, key);
  return c.json({ system, prompt: saved_prompt ?? prompt, generated_prompt: prompt, saved_prompt });
});

r.patch("/meetings/:id/sections/:key/prompt", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{ prompt: string }>;
  const prompt = body.prompt?.trim();
  if (!prompt) return c.json({ error: "prompt required" }, 400);
  db.run(
    `INSERT INTO section_prompt_overrides (user_id, meeting_id, section_key, prompt, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, meeting_id, section_key)
     DO UPDATE SET prompt = excluded.prompt, updated_at = datetime('now')`,
    [user.id, id, key, prompt],
  );
  const { system, prompt: generated_prompt } = buildSectionPrompt(m, draft);
  return c.json({ system, prompt, generated_prompt, saved_prompt: prompt });
});

r.delete("/meetings/:id/sections/:key/prompt", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const draft = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  if (!draft) return c.json({ error: "section not found" }, 404);
  db.run("DELETE FROM section_prompt_overrides WHERE user_id = ? AND meeting_id = ? AND section_key = ?", [
    user.id,
    id,
    key,
  ]);
  const { system, prompt } = buildSectionPrompt(m, draft);
  return c.json({ system, prompt, generated_prompt: prompt, saved_prompt: null });
});

r.post("/meetings/:id/sections/:key/generate", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user);
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

  const { system, prompt: generatedPrompt, sources } = buildSectionPrompt(m, draft, body.source_ids);
  const savedPrompt = sectionPromptOverride(user.id, id, key);
  const basePrompt = savedPrompt
    ? `${savedPrompt}\n\nCurrent source material for this run (authoritative):\n${sources}\n\nUse the current source material above when updating the section.`
    : generatedPrompt;
  const override = body.prompt_override?.trim();
  const userInstruction = body.user_prompt?.trim();
  const prompt = override
    ? `${override}\n\nCurrent source material for this run (authoritative):\n${sources}\n\nUse the current source material above when updating the section.`
    : userInstruction
      ? sourceLikeUserPrompt(userInstruction)
        ? `${basePrompt}\n\nAdditional source material pasted by the user:\n${userInstruction}\n\nTreat the pasted material as intentionally selected evidence for this section run. Use the uploaded sources and the pasted source material above to update the section; do not leave the section unchanged merely because the material is free-form text or organised by month/project.`
        : `${basePrompt}\n\nAdditional instruction:\n${userInstruction}`
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
      section: row ? rowToSection(row, variablesForMeeting(m), user.id) : null,
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
