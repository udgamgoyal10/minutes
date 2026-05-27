import { Hono } from "hono";
import { db } from "../config/db.ts";
import { requireAuth } from "../middleware/auth.ts";
import { generate, type ProviderId } from "../services/ai/index.ts";
import { buildPrompt, type PromptContext } from "../services/prompts/index.ts";
import type { ParsedTemplate } from "../services/template-parser.ts";

const r = new Hono();
r.use("*", requireAuth);

type SectionRow = {
  id: number;
  meeting_id: number;
  section_key: string;
  ordinal: number;
  title: string;
  content_md: string;
  status: string;
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

r.get("/meetings/:id/sections", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);
  const rows = db.query<SectionRow, [number]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
  ).all(id);
  return c.json({ sections: rows });
});

r.patch("/meetings/:id/sections/:key", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const key = c.req.param("key");
  const m = loadMeetingCtx(id, user.id);
  if (!m) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as Partial<{
    content_md: string;
    status: "pending" | "draft" | "approved";
  }>;
  db.run(
    `UPDATE section_drafts
     SET content_md = COALESCE(?, content_md),
         status = COALESCE(?, status),
         updated_at = datetime('now')
     WHERE meeting_id = ? AND section_key = ?`,
    [body.content_md ?? null, body.status ?? null, id, key],
  );
  const row = db.query<SectionRow, [number, string]>(
    "SELECT * FROM section_drafts WHERE meeting_id = ? AND section_key = ?",
  ).get(id, key);
  return c.json({ section: row });
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
    source_ids: number[]; // optional whitelist
  }>;

  const provider = (body.provider || m.ai_provider || "ollama") as ProviderId;
  const parsed = JSON.parse(m.parsed_json) as ParsedTemplate;
  const section = parsed.sections.find((s) => s.key === key);
  if (!section) return c.json({ error: "section not in template" }, 404);

  // Pull sources
  let sourceRows: Array<{ id: number; kind: string; label: string | null; extracted_text: string | null }>;
  if (body.source_ids && body.source_ids.length) {
    const placeholders = body.source_ids.map(() => "?").join(",");
    sourceRows = db.query<typeof sourceRows[number], number[]>(
      `SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ? AND id IN (${placeholders})`,
    ).all(id, ...body.source_ids) as typeof sourceRows;
  } else {
    sourceRows = db.query<typeof sourceRows[number], [number]>(
      "SELECT id, kind, label, extracted_text FROM sources WHERE meeting_id = ?",
    ).all(id) as typeof sourceRows;
  }

  const ctx: PromptContext = {
    organizationName: m.org_name,
    meetingTitle: m.label,
    meetingDate: m.meeting_date ?? "",
    previousMeetingDate: m.previous_meeting_date ?? "",
    variables: JSON.parse(m.variables_json) as Record<string, string>,
    section,
    sources: sourceRows.map((s) => ({
      label: s.label ?? "",
      kind: s.kind,
      text: (s.extracted_text ?? "").slice(0, 40000),
    })),
  };
  const { system, prompt: basePrompt } = buildPrompt(ctx);
  const userInstruction = body.user_prompt?.trim();
  const prompt = userInstruction ? `${basePrompt}\n\nAdditional instruction:\n${userInstruction}` : basePrompt;

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
    return c.json({ section: row, ai: { provider: result.provider, model: result.model, duration_ms: duration } });
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
