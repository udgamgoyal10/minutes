import { Hono } from "hono";
import { db } from "../config/db.ts";
import { isAdminRole, requireAuth } from "../middleware/auth.ts";
import { renderCombinedDocx, renderDocx, type ApprovedSection } from "../services/docx-render.ts";
import { renderPdfFromDocx } from "../services/pdf-render.ts";
import type { ParsedTemplate } from "../services/template-parser.ts";
import { buildTemplateVariables, fillTemplateText } from "../services/template-variables.ts";

const r = new Hono();
r.use("*", requireAuth);

type Ctx = {
  id: number;
  variables_json: string;
  meeting_date: string | null;
  previous_meeting_date: string | null;
  label: string;
  docx_path: string;
  parsed_json: string;
  created_at: string;
};

function loadCtx(meetingId: number, user: { id: number; role: string }): Ctx | null {
  if (isAdminRole(user.role)) {
    return db.query<Ctx, [number]>(
      `SELECT m.id, m.variables_json, m.meeting_date, m.previous_meeting_date, m.label, m.created_at, t.docx_path, t.parsed_json
       FROM meetings m
       JOIN meeting_templates t ON t.id = m.template_id
       WHERE m.id = ?`,
    ).get(meetingId) ?? null;
  }
  return db.query<Ctx, [number, number]>(
    `SELECT m.id, m.variables_json, m.meeting_date, m.previous_meeting_date, m.label, m.created_at, t.docx_path, t.parsed_json
     FROM meetings m
     JOIN meeting_templates t ON t.id = m.template_id
     WHERE m.id = ? AND m.user_id = ?`,
  ).get(meetingId, user.id) ?? null;
}

function loadSections(meetingId: number, ctx: Ctx, filled: boolean): ApprovedSection[] {
  const rows = db.query<ApprovedSection, [number]>(
    "SELECT section_key as key, ordinal, title, content_md, template_body_text FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal",
  ).all(meetingId);
  if (!filled) return rows;
  const variables = buildTemplateVariables({
    variables: JSON.parse(ctx.variables_json) as Record<string, string>,
    meetingDate: ctx.meeting_date,
    previousMeetingDate: ctx.previous_meeting_date,
  });
  return rows.map((row) => ({
    ...row,
    title: fillTemplateText(row.title, variables),
    content_md: fillTemplateText(row.content_md, variables),
  }));
}

async function buildDocx(meetingId: number, ctx: Ctx): Promise<Uint8Array> {
  const parsed = JSON.parse(ctx.parsed_json) as ParsedTemplate;
  return renderDocx({
    templatePath: ctx.docx_path,
    parsed,
    variables: buildTemplateVariables({
      variables: JSON.parse(ctx.variables_json) as Record<string, string>,
      meetingDate: ctx.meeting_date,
      previousMeetingDate: ctx.previous_meeting_date,
    }),
    sections: loadSections(meetingId, ctx, false),
  });
}

r.get("/meetings/:id/export/docx", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const ctx = loadCtx(id, user);
  if (!ctx) return c.json({ error: "not found" }, 404);
  const bytes = await buildDocx(id, ctx);
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safe(ctx.label)}.docx"`,
    },
  });
});

r.post("/meetings/export/docx", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{ meeting_ids: number[] }>;
  const ids = Array.isArray(body.meeting_ids)
    ? [...new Set(body.meeting_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  if (!ids.length) return c.json({ error: "meeting_ids required" }, 400);
  const contexts = ids.map((id) => loadCtx(id, user)).filter((ctx): ctx is Ctx => ctx != null);
  if (contexts.length !== ids.length) return c.json({ error: "one or more meetings were not found" }, 404);
  contexts.sort((a, b) => sortDate(a).localeCompare(sortDate(b)) || a.id - b.id);
  const bytes = await renderCombinedDocx({
    templatePath: contexts[0]!.docx_path,
    meetings: contexts.map((ctx) => ({
      heading: meetingHeading(ctx),
      sections: loadSections(ctx.id, ctx, true),
    })),
  });
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safe("combined-minutes")}.docx"`,
    },
  });
});

r.get("/meetings/:id/export/pdf", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const ctx = loadCtx(id, user);
  if (!ctx) return c.json({ error: "not found" }, 404);
  const docxBytes = await buildDocx(id, ctx);
  const pdfBytes = await renderPdfFromDocx(docxBytes);
  return new Response(pdfBytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safe(ctx.label)}.pdf"`,
    },
  });
});

r.get("/meetings/:id/preview", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const ctx = loadCtx(id, user);
  if (!ctx) return c.json({ error: "not found" }, 404);
  const sections = db.query<{ section_key: string; ordinal: number; title: string; content_md: string; status: string }, [number]>(
    "SELECT section_key, ordinal, title, content_md, status FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal",
  ).all(id);
  const variables = buildTemplateVariables({
    variables: JSON.parse(ctx.variables_json) as Record<string, string>,
    meetingDate: ctx.meeting_date,
    previousMeetingDate: ctx.previous_meeting_date,
  });
  return c.json({
    label: ctx.label,
    variables,
    sections: sections.map((section) => ({
      ...section,
      content_md: fillTemplateText(section.content_md, variables),
    })),
  });
});

function meetingHeading(ctx: Ctx): string {
  return ctx.meeting_date ? `${ctx.label} — ${ctx.meeting_date}` : ctx.label;
}

function sortDate(ctx: Ctx): string {
  return ctx.meeting_date || ctx.created_at || String(ctx.id).padStart(12, "0");
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "minutes";
}

export default r;
