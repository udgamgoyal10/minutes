import { Hono } from "hono";
import { db } from "../config/db.ts";
import { isAdminRole, requireAuth } from "../middleware/auth.ts";
import { inferRequiredSources } from "../services/source-recommendations.ts";
import { canonicalPlaceholder, canonicalToken, inferRequiredVariables, setupVariableCatalog } from "../services/template-variables.ts";
import type { ParsedTemplate } from "../services/template-parser.ts";
import { getMeetingStructure, listOrganizationSections } from "../services/organization-templates.ts";

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
  organization_id: number | null;
  meeting_structure_id: number | null;
  user_id: number;
  label: string;
  meeting_date: string | null;
  previous_meeting_date: string | null;
  is_annual: number;
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
  required_variables_json: string | null;
  created_at: string;
  owner_email?: string;
};
type SectionTemplateSummary = {
  key: string;
  title: string;
  body_text: string;
  placeholders: { token: string; raw: string }[];
  required_sources: string[];
  required_variables: string[];
  template_id: number;
  template_slug: string;
  template_title: string;
  custom_id?: number;
  owner_user_id?: number;
  owner_email?: string | null;
  can_edit?: boolean;
};

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function mergeVariables(...sets: string[][]): string[] {
  const out = new Set<string>();
  for (const set of sets) for (const value of set) out.add(value);
  return [...out];
}

function userMappedVariables(userId: number, sectionKey: string): string[] {
  return db.query<MappingRow, [number, string]>(
    "SELECT token FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ? ORDER BY token",
  ).all(userId, sectionKey).map((row) => row.token);
}

function userExcludedVariables(userId: number, sectionKey: string): Set<string> {
  return new Set(db.query<MappingRow, [number, string]>(
    "SELECT token FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?",
  ).all(userId, sectionKey).map((row) => row.token));
}

function effectiveRequiredVariables(userId: number, sectionKey: string, base: string[]): string[] {
  const excluded = userExcludedVariables(userId, sectionKey);
  return mergeVariables(base, userMappedVariables(userId, sectionKey)).filter((token) => !excluded.has(token));
}

function sectionTemplateKeysForUser(userId: number): Set<string> {
  const keys = new Set<string>();
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    for (const section of parsed.sections) keys.add(section.key);
  }
  const customRows = db.query<{ key: string }, [number]>(
    "SELECT key FROM custom_section_templates WHERE user_id = ?",
  ).all(userId);
  for (const row of customRows) keys.add(row.key);
  return keys;
}

function validateSectionKeys(userId: number, sectionKeys: unknown): string[] | null {
  if (!Array.isArray(sectionKeys)) return null;
  const keys = sectionKeys.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  if (!keys.length) return null;
  const valid = sectionTemplateKeysForUser(userId);
  return keys.every((key) => valid.has(key)) ? [...new Set(keys)] : null;
}

function baseSectionKeysForToken(userId: number, token: string): string[] {
  const keys = new Set<string>();
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    for (const section of parsed.sections) {
      if (inferRequiredVariables(section.bodyText, section.title).includes(token)) keys.add(section.key);
    }
  }
  const customRows = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE user_id = ?",
  ).all(userId);
  for (const row of customRows) {
    if (parseStringArray(row.required_variables_json ?? "[]").includes(token)) keys.add(row.key);
  }
  return [...keys];
}

function saveVariableMapping(userId: number, token: string, raw: string, kind: string, sectionKeys: string[]) {
  const selected = new Set(sectionKeys);
  db.run(
    `INSERT INTO user_template_variables (user_id, token, raw, kind, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, token) DO UPDATE SET raw = excluded.raw, kind = excluded.kind, updated_at = datetime('now')`,
    [userId, token, raw, kind],
  );
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND token = ?", [userId, token]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND token = ?", [userId, token]);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_template_variable_mappings (user_id, token, section_key) VALUES (?, ?, ?)",
  );
  for (const key of sectionKeys) insert.run(userId, token, key);
  const exclude = db.prepare(
    "INSERT OR IGNORE INTO user_template_variable_mapping_exclusions (user_id, token, section_key) VALUES (?, ?, ?)",
  );
  for (const key of baseSectionKeysForToken(userId, token)) {
    if (!selected.has(key)) exclude.run(userId, token, key);
  }
}

function catalogForUser(userId: number) {
  const base = setupVariableCatalog();
  const mappedByToken = new Map<string, Set<string>>();
  for (const section of sectionTemplateCatalog(userId)) {
    for (const token of section.required_variables) {
      const keys = mappedByToken.get(token) ?? new Set<string>();
      keys.add(section.key);
      mappedByToken.set(token, keys);
    }
  }
  const rows = db.query<UserVariableRow, [number]>(
    `SELECT v.token, v.raw, v.kind, group_concat(m.section_key) AS section_keys
     FROM user_template_variables v
     LEFT JOIN user_template_variable_mappings m ON m.user_id = v.user_id AND m.token = v.token
     WHERE v.user_id = ?
     GROUP BY v.token
     ORDER BY v.raw COLLATE NOCASE ASC`,
  ).all(userId);
  const overrides = new Map(rows.map((row) => [row.token, row]));
  const out = base.map((v) => {
    const override = overrides.get(v.token);
    return {
      ...v,
      raw: override?.raw ?? v.raw,
      kind: override ? (override.kind === "date" ? "date" as const : "text" as const) : v.kind,
      editable: true,
      custom: false,
      section_keys: [...(mappedByToken.get(v.token) ?? new Set<string>())],
    };
  });
  const baseTokens = new Set(base.map((v) => v.token));
  for (const row of rows) {
    if (baseTokens.has(row.token)) continue;
    out.push({
      token: row.token,
      raw: row.raw,
      kind: row.kind === "date" ? "date" as const : "text" as const,
      editable: true,
      custom: true,
      section_keys: [...(mappedByToken.get(row.token) ?? new Set<string>())],
    });
  }
  return out;
}

function baseRequiredVariablesForSection(userId: number, sectionKey: string): string[] | null {
  const custom = db.query<CustomTemplateRow, [number, string]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE user_id = ? AND key = ?",
  ).get(userId, sectionKey);
  if (custom) return parseStringArray(custom.required_variables_json ?? "[]");
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    const section = parsed.sections.find((s) => s.key === sectionKey);
    if (section) return inferRequiredVariables(section.bodyText, section.title);
  }
  return null;
}

function baseSectionForKey(sectionKey: string): ParsedTemplate["sections"][number] | null {
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    const section = parsed.sections.find((s) => s.key === sectionKey);
    if (section) return section;
  }
  return null;
}

function setSectionVariableLinks(userId: number, sectionKey: string, tokens: string[]): boolean {
  const desired = [...new Set(tokens.filter((x) => typeof x === "string" && x.trim().length > 0).map(canonicalToken))];
  const custom = db.query<CustomTemplateRow, [number, string]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE user_id = ? AND key = ?",
  ).get(userId, sectionKey);
  if (custom) {
    db.run("UPDATE custom_section_templates SET required_variables_json = ? WHERE id = ? AND user_id = ?", [
      JSON.stringify(desired),
      custom.id,
      userId,
    ]);
    db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ?", [userId, sectionKey]);
    db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?", [userId, sectionKey]);
    return true;
  }
  const base = baseRequiredVariablesForSection(userId, sectionKey);
  if (!base) return false;
  const baseSet = new Set(base);
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ?", [userId, sectionKey]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?", [userId, sectionKey]);
  const insertMapping = db.prepare(
    "INSERT OR IGNORE INTO user_template_variable_mappings (user_id, token, section_key) VALUES (?, ?, ?)",
  );
  const insertExclusion = db.prepare(
    "INSERT OR IGNORE INTO user_template_variable_mapping_exclusions (user_id, token, section_key) VALUES (?, ?, ?)",
  );
  for (const token of desired) {
    if (!baseSet.has(token)) insertMapping.run(userId, token, sectionKey);
  }
  const desiredSet = new Set(desired);
  for (const token of baseSet) {
    if (!desiredSet.has(token)) insertExclusion.run(userId, token, sectionKey);
  }
  return true;
}

function addNewVariablesForSection(userId: number, sectionKey: string, variables: unknown): string[] {
  if (!Array.isArray(variables)) return [];
  const tokens: string[] = [];
  for (const item of variables) {
    const raw = typeof item === "string" ? item : typeof item?.raw === "string" ? item.raw : "";
    const kind = typeof item === "object" && item && (item as { kind?: string }).kind === "date" ? "date" : "text";
    const placeholder = canonicalPlaceholder(raw);
    if (!placeholder) continue;
    saveVariableMapping(userId, placeholder.token, placeholder.raw, kind, [sectionKey]);
    tokens.push(placeholder.token);
  }
  return [...new Set(tokens)];
}

function customToSection(row: CustomTemplateRow, userId?: number, canEdit = true) {
  const baseVars = parseStringArray(row.required_variables_json ?? "[]");
  return {
    key: row.key,
    title: row.title,
    body_text: row.body_text,
    placeholders: [] as { token: string; raw: string }[],
    required_sources: parseStringArray(row.required_sources_json),
    required_variables: userId ? effectiveRequiredVariables(userId, row.key, baseVars) : baseVars,
    template_id: -1,
    template_slug: `custom-${row.user_id}`,
    template_title: row.user_id === userId ? "My templates" : `Shared templates${row.owner_email ? ` (${row.owner_email})` : ""}`,
    custom_id: canEdit ? row.id : undefined,
    owner_user_id: row.user_id,
    owner_email: row.owner_email ?? null,
    can_edit: canEdit,
  };
}

function sectionTemplateCatalog(userId: number, role = "user"): SectionTemplateSummary[] {
  const rows = db.query<TemplateRow, []>(
    "SELECT id, organization_id, slug, title, docx_path, parsed_json FROM meeting_templates ORDER BY slug",
  ).all();
  const seen = new Set<string>();
  const overriddenKeys = new Set<string>();
  const sections: SectionTemplateSummary[] = [];
  const customRows = db.query<CustomTemplateRow, [number]>(
    `SELECT c.id, c.user_id, c.key, c.title, c.body_text, c.required_sources_json, c.required_variables_json, c.created_at,
            u.email AS owner_email
     FROM custom_section_templates c
     JOIN users u ON u.id = c.user_id
     ORDER BY CASE WHEN c.user_id = ? THEN 0 ELSE 1 END, c.created_at DESC`,
  ).all(userId);
  for (const row of customRows) {
    const isOwn = row.user_id === userId;
    const isBaseOverride = baseSectionForKey(row.key) != null;
    const canEdit = isOwn || isAdminRole(role);
    if (isOwn && isBaseOverride) overriddenKeys.add(row.key);
    if (isOwn) seen.add(normalizeSectionTitle(row.title));
    sections.push(customToSection(row, userId, canEdit));
  }
  for (const row of rows) {
    const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
    for (const section of parsed.sections) {
      if (overriddenKeys.has(section.key)) continue;
      const dedupeKey = normalizeSectionTitle(section.title);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const baseVars = inferRequiredVariables(section.bodyText, section.title);
      sections.push({
        key: section.key,
        title: section.title,
        body_text: section.bodyText,
        placeholders: section.placeholders,
        required_sources: inferRequiredSources(section.title, section.bodyText),
        required_variables: effectiveRequiredVariables(userId, section.key, baseVars),
        template_id: row.id,
        template_slug: row.slug,
        template_title: row.title,
      });
    }
  }
  return sections;
}

r.get("/template-variables", (c) => {
  const user = c.get("user");
  return c.json({ variables: catalogForUser(user.id) });
});

r.post("/template-variables", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{ raw: string; kind: string; section_keys: string[] }>;
  const placeholder = canonicalPlaceholder(body.raw ?? "");
  if (!placeholder) return c.json({ error: "variable name required" }, 400);
  const sectionKeys = validateSectionKeys(user.id, body.section_keys);
  if (!sectionKeys) return c.json({ error: "template variable must be mapped to at least one valid section template" }, 400);
  saveVariableMapping(user.id, placeholder.token, placeholder.raw, body.kind === "date" ? "date" : "text", sectionKeys);
  return c.json({ variables: catalogForUser(user.id) }, 201);
});

r.patch("/template-variables/:token", async (c) => {
  const user = c.get("user");
  const token = canonicalToken(c.req.param("token"));
  const body = await c.req.json().catch(() => ({})) as Partial<{ raw: string; kind: string; section_keys: string[] }>;
  const raw = body.raw?.trim();
  if (!raw) return c.json({ error: "variable name required" }, 400);
  const sectionKeys = validateSectionKeys(user.id, body.section_keys);
  if (!sectionKeys) return c.json({ error: "template variable must be mapped to at least one valid section template" }, 400);
  saveVariableMapping(user.id, token, raw, body.kind === "date" ? "date" : "text", sectionKeys);
  return c.json({ variables: catalogForUser(user.id) });
});

r.delete("/template-variables/:token", (c) => {
  const user = c.get("user");
  const token = canonicalToken(c.req.param("token"));
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND token = ?", [user.id, token]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND token = ?", [user.id, token]);
  db.run("DELETE FROM user_template_variables WHERE user_id = ? AND token = ?", [user.id, token]);
  db.run("DELETE FROM template_variable_values WHERE user_id = ? AND token = ?", [user.id, token]);
  const customRows = db.query<{ id: number; required_variables_json: string | null }, [number]>(
    "SELECT id, required_variables_json FROM custom_section_templates WHERE user_id = ?",
  ).all(user.id);
  const updateCustom = db.prepare("UPDATE custom_section_templates SET required_variables_json = ? WHERE id = ?");
  for (const row of customRows) {
    const next = parseStringArray(row.required_variables_json ?? "[]").filter((t) => t !== token);
    updateCustom.run(JSON.stringify(next), row.id);
  }
  return c.json({ variables: catalogForUser(user.id) });
});

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
  const organizationId = Number(c.req.query("organization_id"));
  if (organizationId) return c.json({ sections: listOrganizationSections(organizationId, user.id) });
  return c.json({ sections: sectionTemplateCatalog(user.id, user.role) });
});

r.patch("/section-templates/:key/variables", async (c) => {
  const user = c.get("user");
  const key = c.req.param("key");
  if (!sectionTemplateKeysForUser(user.id).has(key)) return c.json({ error: "section template not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    required_variables: string[];
    new_variables: Array<{ raw: string; kind?: string }>;
  }>;
  const newVarTokens = addNewVariablesForSection(user.id, key, body.new_variables);
  const tokens = mergeVariables(
    Array.isArray(body.required_variables)
      ? body.required_variables.filter((x): x is string => typeof x === "string")
      : (baseRequiredVariablesForSection(user.id, key) ?? []),
    newVarTokens,
  );
  if (!setSectionVariableLinks(user.id, key, tokens)) return c.json({ error: "section template not found" }, 404);
  const section = sectionTemplateCatalog(user.id).find((s) => s.key === key) ?? null;
  return c.json({ section, variables: catalogForUser(user.id) });
});

r.patch("/section-templates/:key", async (c) => {
  const user = c.get("user");
  const key = c.req.param("key");
  const baseSection = baseSectionForKey(key);
  if (!baseSection) return c.json({ error: "section template not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
    new_variables: Array<{ raw: string; kind?: string }>;
  }>;
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);
  const bodyText = typeof body.body_text === "string" ? body.body_text : baseSection.bodyText;
  const required = Array.isArray(body.required_sources)
    ? body.required_sources.filter((x): x is string => typeof x === "string")
    : inferRequiredSources(title, bodyText);
  const newVarTokens = addNewVariablesForSection(user.id, key, body.new_variables);
  const requiredVars = mergeVariables(
    Array.isArray(body.required_variables)
      ? body.required_variables.filter((x): x is string => typeof x === "string")
      : inferRequiredVariables(bodyText, title),
    newVarTokens,
  );
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ?", [user.id, key]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?", [user.id, key]);
  const existing = db.query<{ id: number }, [number, string]>(
    "SELECT id FROM custom_section_templates WHERE user_id = ? AND key = ? ORDER BY id LIMIT 1",
  ).get(user.id, key);
  if (existing) {
    db.run(
      `UPDATE custom_section_templates
       SET title = ?, body_text = ?, required_sources_json = ?, required_variables_json = ?
       WHERE id = ? AND user_id = ?`,
      [title, bodyText, JSON.stringify(required), JSON.stringify(requiredVars), existing.id, user.id],
    );
  } else {
    db.run(
      `INSERT INTO custom_section_templates (user_id, key, title, body_text, required_sources_json, required_variables_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, key, title, bodyText, JSON.stringify(required), JSON.stringify(requiredVars)],
    );
  }
  const row = db.query<CustomTemplateRow, [number, string]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE user_id = ? AND key = ? ORDER BY id LIMIT 1",
  ).get(user.id, key);
  return c.json({ template: row ? customToSection(row, user.id) : null, variables: catalogForUser(user.id) });
});

r.post("/section-templates", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
    new_variables: Array<{ raw: string; kind?: string }>;
  }>;
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);
  const key = normalizeSectionTitle(title) || `custom-${Date.now()}`;
  const required = Array.isArray(body.required_sources)
    ? body.required_sources.filter((x): x is string => typeof x === "string")
    : [];
  const newVarTokens = addNewVariablesForSection(user.id, key, body.new_variables);
  const requiredVars = mergeVariables(
    Array.isArray(body.required_variables)
      ? body.required_variables.filter((x): x is string => typeof x === "string")
      : inferRequiredVariables(body.body_text ?? "", title),
    newVarTokens,
  );
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ?", [user.id, key]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?", [user.id, key]);
  const res = db.run(
    `INSERT INTO custom_section_templates (user_id, key, title, body_text, required_sources_json, required_variables_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, key, title, body.body_text ?? "", JSON.stringify(required), JSON.stringify(requiredVars)],
  );
  const row = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE id = ?",
  ).get(Number(res.lastInsertRowid));
  return c.json({ template: row ? customToSection(row, user.id) : null }, 201);
});

r.patch("/section-templates/custom/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const existing = isAdminRole(user.role)
    ? db.query<CustomTemplateRow, [number]>(
        "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE id = ?",
      ).get(id)
    : db.query<CustomTemplateRow, [number, number]>(
        "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE id = ? AND user_id = ?",
      ).get(id, user.id);
  if (!existing) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
    new_variables: Array<{ raw: string; kind?: string }>;
  }>;
  const title = body.title?.trim() || existing.title;
  const key = existing.key;
  const required = Array.isArray(body.required_sources)
    ? body.required_sources.filter((x): x is string => typeof x === "string")
    : parseStringArray(existing.required_sources_json);
  const newVarTokens = addNewVariablesForSection(existing.user_id, key, body.new_variables);
  const requiredVars = mergeVariables(
    Array.isArray(body.required_variables)
      ? body.required_variables.filter((x): x is string => typeof x === "string")
      : parseStringArray(existing.required_variables_json ?? "[]"),
    newVarTokens,
  );
  db.run("DELETE FROM user_template_variable_mappings WHERE user_id = ? AND section_key = ?", [existing.user_id, key]);
  db.run("DELETE FROM user_template_variable_mapping_exclusions WHERE user_id = ? AND section_key = ?", [existing.user_id, key]);
  db.run(
    `UPDATE custom_section_templates
     SET title = ?, key = ?, body_text = ?, required_sources_json = ?, required_variables_json = ?
     WHERE id = ?`,
    [title, key, body.body_text ?? existing.body_text, JSON.stringify(required), JSON.stringify(requiredVars), id],
  );
  const row = db.query<CustomTemplateRow, [number]>(
    "SELECT id, user_id, key, title, body_text, required_sources_json, required_variables_json, created_at FROM custom_section_templates WHERE id = ?",
  ).get(id);
  return c.json({ template: row ? customToSection(row, user.id, true) : null });
});

r.delete("/section-templates/custom/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (isAdminRole(user.role)) {
    db.run("DELETE FROM custom_section_templates WHERE id = ?", [id]);
  } else {
    db.run("DELETE FROM custom_section_templates WHERE id = ? AND user_id = ?", [id, user.id]);
  }
  return c.json({ ok: true });
});

type VariableValueRow = { token: string; value: string; gender: string | null };
type UserVariableRow = { token: string; raw: string; kind: string; section_keys: string | null };
type MappingRow = { token: string };

function normalizeGender(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["male", "m", "he", "him", "his"].includes(v)) return "male";
  if (["female", "f", "she", "her"].includes(v)) return "female";
  return null;
}

function variableValuesForUser(userId: number) {
  const rows = db.query<VariableValueRow, [number]>(
    "SELECT token, value, gender FROM template_variable_values WHERE user_id = ? ORDER BY value COLLATE NOCASE ASC",
  ).all(userId);
  const values: Record<string, string[]> = {};
  const genders: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    (values[row.token] ??= []).push(row.value);
    if (row.gender) (genders[row.token] ??= {})[row.value] = row.gender;
  }
  return { values, genders };
}

r.get("/variable-values", (c) => {
  const user = c.get("user");
  return c.json(variableValuesForUser(user.id));
});

r.post("/variable-values", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{
    entries: Array<{ token: string; value: string; gender?: string }>;
    token: string;
    value: string;
    gender: string;
  }>;
  const entries = body.entries ?? (body.token ? [{ token: body.token, value: body.value ?? "", gender: body.gender }] : []);
  const insert = db.prepare(
    `INSERT INTO template_variable_values (user_id, token, value, gender)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, token, value) DO UPDATE SET gender = COALESCE(excluded.gender, gender)`,
  );
  const tx = db.transaction(() => {
    for (const e of entries) {
      const token = typeof e.token === "string" ? e.token.trim() : "";
      const value = typeof e.value === "string" ? e.value.trim() : "";
      if (token && value) insert.run(user.id, token, value, normalizeGender(e.gender));
    }
  });
  tx();
  return c.json(variableValuesForUser(user.id));
});

r.patch("/variable-values", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{ token: string; old_value: string; value: string; gender?: string }>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const oldValue = typeof body.old_value === "string" ? body.old_value.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!token || !oldValue || !value) return c.json({ error: "token, old_value and value required" }, 400);
  if (Object.prototype.hasOwnProperty.call(body, "gender")) {
    db.run("UPDATE template_variable_values SET value = ?, gender = ? WHERE user_id = ? AND token = ? AND value = ?", [
      value,
      normalizeGender(body.gender),
      user.id,
      token,
      oldValue,
    ]);
  } else {
    db.run("UPDATE template_variable_values SET value = ? WHERE user_id = ? AND token = ? AND value = ?", [value, user.id, token, oldValue]);
  }
  return c.json(variableValuesForUser(user.id));
});

r.delete("/variable-values", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Partial<{ token: string; value: string }>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!token || !value) return c.json({ error: "token and value required" }, 400);
  db.run("DELETE FROM template_variable_values WHERE user_id = ? AND token = ? AND value = ?", [user.id, token, value]);
  return c.json(variableValuesForUser(user.id));
});

r.get("/meetings", (c) => {
  const user = c.get("user");
  const rows = isAdminRole(user.role)
    ? db.query<MeetingRow & { owner_email: string }, []>(
        `SELECT m.*, u.email AS owner_email
         FROM meetings m
         JOIN users u ON u.id = m.user_id
         ORDER BY m.updated_at DESC`,
      ).all()
    : db.query<MeetingRow & { owner_email: string }, [number]>(
        `SELECT m.*, u.email AS owner_email
         FROM meetings m
         JOIN users u ON u.id = m.user_id
         WHERE m.user_id = ?
         ORDER BY m.updated_at DESC`,
      ).all(user.id);
  return c.json({ meetings: rows.map(rowToMeeting) });
});

r.post("/meetings", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null) as
    | { template_id?: number; structure_id?: number; label?: string }
    | null;
  const structure = body?.structure_id ? getMeetingStructure(body.structure_id, user.id) : null;
  if (body?.structure_id && !structure) return c.json({ error: "meeting type not found" }, 404);
  const templateId = structure?.base_template_id ?? body?.template_id;
  if (!templateId) return c.json({ error: "structure_id required" }, 400);
  const tpl = db.query<TemplateRow, [number]>("SELECT * FROM meeting_templates WHERE id = ?")
    .get(templateId);
  if (!tpl) return c.json({ error: "document layout not found" }, 404);
  const organizationId = structure?.organization_id ?? tpl.organization_id;
  const label = body?.label?.trim() || `${structure?.name ?? tpl.title} — ${new Date().toLocaleDateString()}`;
  const parsed = JSON.parse(tpl.parsed_json) as ParsedTemplate;
  const legacyCatalog = new Map(sectionTemplateCatalog(user.id).map((section) => [section.key, section]));
  const resolvedSections = structure?.sections ?? parsed.sections.map((section) => {
    const catalogSection = legacyCatalog.get(section.key);
    return {
      key: section.key,
      title: catalogSection?.title ?? section.title,
      body_text: catalogSection?.body_text ?? section.bodyText,
      required_sources: catalogSection?.required_sources ?? inferRequiredSources(section.title, section.bodyText),
      required_variables: catalogSection?.required_variables ?? inferRequiredVariables(section.bodyText, section.title),
    };
  });
  const insertSec = db.prepare(
    `INSERT INTO section_drafts (meeting_id, section_key, ordinal, title, content_md, template_body_text, status, mode, required_sources_json, required_variables_json)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'template', ?, ?)`,
  );
  let meetingId = 0;
  const tx = db.transaction(() => {
    const result = db.run(
      `INSERT INTO meetings
         (template_id, organization_id, meeting_structure_id, user_id, label, variables_json)
       VALUES (?, ?, ?, ?, ?, '{}')`,
      [tpl.id, organizationId, structure?.id ?? null, user.id, label],
    );
    meetingId = Number(result.lastInsertRowid);
    resolvedSections.forEach((section, index) => {
      const requiredVariables = effectiveRequiredVariables(user.id, section.key, section.required_variables);
      insertSec.run(
        meetingId,
        section.key,
        index + 1,
        section.title,
        section.body_text,
        section.body_text,
        JSON.stringify(section.required_sources),
        JSON.stringify(requiredVariables),
      );
    });
  });
  tx();

  const meeting = db.query<MeetingRow, [number]>("SELECT * FROM meetings WHERE id = ?")
    .get(meetingId);
  return c.json({ meeting: meeting ? rowToMeeting(meeting) : null }, 201);
});

r.get("/meetings/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = getMeeting(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  return c.json({ meeting: m });
});

r.patch("/meetings/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const m = getMeetingRow(id, user);
  if (!m) return c.json({ error: "not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    label: string;
    meeting_date: string;
    previous_meeting_date: string;
    is_annual: boolean;
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
      is_annual = COALESCE(?, is_annual),
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
      body.is_annual == null ? null : body.is_annual ? 1 : 0,
      vars,
      body.ai_provider ?? null,
      body.ai_model ?? null,
      body.status ?? null,
      id,
    ],
  );
  return c.json({ meeting: getMeeting(id, user) });
});

r.delete("/meetings/:id", (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (!getMeetingRow(id, user)) return c.json({ error: "not found" }, 404);
  db.run("DELETE FROM meetings WHERE id = ?", [id]);
  return c.json({ ok: true });
});

function getMeetingRow(id: number, user: { id: number; role: string }): MeetingRow | null {
  if (isAdminRole(user.role)) {
    return db.query<MeetingRow, [number]>(
      "SELECT * FROM meetings WHERE id = ?",
    ).get(id) ?? null;
  }
  return db.query<MeetingRow, [number, number]>(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?",
  ).get(id, user.id) ?? null;
}

function getMeeting(id: number, user: { id: number; role: string }) {
  const row = getMeetingRow(id, user);
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
    organization_id: row.organization_id,
    meeting_structure_id: row.meeting_structure_id,
    user_id: row.user_id,
    owner_email: "owner_email" in row ? (row as MeetingRow & { owner_email?: string }).owner_email ?? null : null,
    label: row.label,
    meeting_date: row.meeting_date,
    previous_meeting_date: row.previous_meeting_date,
    is_annual: !!row.is_annual,
    variables: JSON.parse(row.variables_json) as Record<string, string>,
    ai_provider: row.ai_provider,
    ai_model: row.ai_model,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default r;
