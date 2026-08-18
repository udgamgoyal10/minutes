import { db } from "../config/db.ts";
import { inferRequiredSources } from "./source-recommendations.ts";
import { inferRequiredVariables } from "./template-variables.ts";

export type ResolvedSectionTemplate = {
  section_template_id: number | null;
  key: string;
  title: string;
  body_text: string;
  placeholders: { token: string; raw: string }[];
  required_sources: string[];
  required_variables: string[];
  template_id: number;
  template_slug: string;
  template_title: string;
  organization_id: number;
  owner_organization_id: number | null;
  is_overridden: boolean;
  is_shared: boolean;
  shared_title: string;
  shared_body_text: string;
  shared_required_sources: string[];
  shared_required_variables: string[];
  custom_id?: number;
  owner_user_id?: number;
  owner_email?: string | null;
  can_edit?: boolean;
};

type DefinitionRow = {
  id: number;
  key: string;
  owner_organization_id: number | null;
  title: string;
  body_text: string;
  required_sources_json: string;
  required_variables_json: string;
  origin_template_id: number | null;
};

type OverrideRow = {
  section_template_id: number;
  title: string;
  body_text: string;
  required_sources_json: string;
  required_variables_json: string;
};

type CustomRow = {
  id: number;
  user_id: number;
  key: string;
  title: string;
  body_text: string;
  required_sources_json: string;
  required_variables_json: string | null;
  owner_email: string | null;
};

type StructureRow = {
  id: number;
  organization_id: number;
  base_template_id: number;
  slug: string;
  name: string;
  description: string;
  meeting_body: string;
  is_annual: number;
  is_default: number;
  is_active: number;
};

export type MeetingStructure = {
  id: number;
  organization_id: number;
  base_template_id: number;
  slug: string;
  name: string;
  description: string;
  meeting_body: string;
  is_annual: boolean;
  is_default: boolean;
  is_active: boolean;
  sections: ResolvedSectionTemplate[];
};

function parseArray(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function definitionRows(organizationId: number): DefinitionRow[] {
  return db
    .query<DefinitionRow, [number]>(
      `SELECT id, key, owner_organization_id, title, body_text,
            required_sources_json, required_variables_json, origin_template_id
     FROM section_template_definitions
     WHERE owner_organization_id IS NULL OR owner_organization_id = ?
     ORDER BY title COLLATE NOCASE, id`,
    )
    .all(organizationId);
}

function overrideMap(organizationId: number): Map<number, OverrideRow> {
  const rows = db
    .query<OverrideRow, [number]>(
      `SELECT section_template_id, title, body_text, required_sources_json, required_variables_json
     FROM organization_section_overrides
     WHERE organization_id = ?`,
    )
    .all(organizationId);
  return new Map(rows.map((row) => [row.section_template_id, row]));
}

function userCustomMap(userId?: number): Map<string, CustomRow> {
  if (!userId) return new Map();
  const rows = db
    .query<CustomRow, [number]>(
      `SELECT c.id, c.user_id, c.key, c.title, c.body_text,
            c.required_sources_json, c.required_variables_json, u.email AS owner_email
     FROM custom_section_templates c
     JOIN users u ON u.id = c.user_id
     WHERE c.user_id = ?
     ORDER BY c.id ASC`,
    )
    .all(userId);
  return new Map(rows.map((row) => [row.key, row]));
}

function toResolved(
  organizationId: number,
  definition: DefinitionRow,
  override: OverrideRow | undefined,
  custom: CustomRow | undefined,
): ResolvedSectionTemplate {
  const title = custom?.title ?? override?.title ?? definition.title;
  const bodyText = custom?.body_text ?? override?.body_text ?? definition.body_text;
  const requiredSources = custom
    ? parseArray(custom.required_sources_json)
    : override
      ? parseArray(override.required_sources_json)
      : parseArray(definition.required_sources_json);
  const requiredVariables = custom
    ? parseArray(custom.required_variables_json)
    : override
      ? parseArray(override.required_variables_json)
      : parseArray(definition.required_variables_json);
  return {
    section_template_id: definition.id,
    key: definition.key,
    title,
    body_text: bodyText,
    placeholders: [],
    required_sources: requiredSources,
    required_variables: requiredVariables,
    template_id: definition.origin_template_id ?? -1,
    template_slug: definition.owner_organization_id == null ? "shared" : "organization",
    template_title: custom
      ? "My templates"
      : override
        ? "Organization override"
        : definition.owner_organization_id == null
          ? "Shared default"
          : "Organization section",
    organization_id: organizationId,
    owner_organization_id: definition.owner_organization_id,
    is_overridden: Boolean(override),
    is_shared: definition.owner_organization_id == null,
    shared_title: definition.title,
    shared_body_text: definition.body_text,
    shared_required_sources: parseArray(definition.required_sources_json),
    shared_required_variables: parseArray(definition.required_variables_json),
    custom_id: custom?.id,
    owner_user_id: custom?.user_id,
    owner_email: custom?.owner_email ?? null,
    can_edit: true,
  };
}

export function listSharedSections(): ResolvedSectionTemplate[] {
  return db
    .query<DefinitionRow, []>(
      `SELECT id, key, owner_organization_id, title, body_text,
            required_sources_json, required_variables_json, origin_template_id
     FROM section_template_definitions
     WHERE owner_organization_id IS NULL
     ORDER BY title COLLATE NOCASE, id`,
    )
    .all()
    .map((definition) => toResolved(0, definition, undefined, undefined));
}

export function updateSharedSection(input: {
  sectionTemplateId: number;
  title: string;
  bodyText: string;
  requiredSources?: string[];
  requiredVariables?: string[];
}): ResolvedSectionTemplate | null {
  const result = db.run(
    `UPDATE section_template_definitions SET
       title = ?, body_text = ?, required_sources_json = ?, required_variables_json = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_organization_id IS NULL`,
    [
      input.title,
      input.bodyText,
      JSON.stringify(input.requiredSources ?? inferRequiredSources(input.title, input.bodyText)),
      JSON.stringify(
        input.requiredVariables ?? inferRequiredVariables(input.bodyText, input.title),
      ),
      input.sectionTemplateId,
    ],
  );
  if (!result.changes) return null;
  return (
    listSharedSections().find(
      (section) => section.section_template_id === input.sectionTemplateId,
    ) ?? null
  );
}

export function listOrganizationSections(
  organizationId: number,
  userId?: number,
): ResolvedSectionTemplate[] {
  const overrides = overrideMap(organizationId);
  const customs = userCustomMap(userId);
  const sections = definitionRows(organizationId).map((definition) =>
    toResolved(
      organizationId,
      definition,
      overrides.get(definition.id),
      customs.get(definition.key),
    ),
  );
  const known = new Set(sections.map((section) => section.key));
  for (const custom of customs.values()) {
    if (known.has(custom.key)) continue;
    sections.push({
      section_template_id: null,
      key: custom.key,
      title: custom.title,
      body_text: custom.body_text,
      placeholders: [],
      required_sources: parseArray(custom.required_sources_json),
      required_variables: parseArray(custom.required_variables_json),
      template_id: -1,
      template_slug: `custom-${custom.user_id}`,
      template_title: "My templates",
      organization_id: organizationId,
      owner_organization_id: organizationId,
      is_overridden: false,
      is_shared: false,
      shared_title: custom.title,
      shared_body_text: custom.body_text,
      shared_required_sources: parseArray(custom.required_sources_json),
      shared_required_variables: parseArray(custom.required_variables_json),
      custom_id: custom.id,
      owner_user_id: custom.user_id,
      owner_email: custom.owner_email,
      can_edit: true,
    });
  }
  return sections.sort((a, b) => a.title.localeCompare(b.title));
}

export function resolveOrganizationSection(
  organizationId: number,
  sectionTemplateId: number,
  userId?: number,
): ResolvedSectionTemplate | null {
  const definition = db
    .query<DefinitionRow, [number, number]>(
      `SELECT id, key, owner_organization_id, title, body_text,
            required_sources_json, required_variables_json, origin_template_id
     FROM section_template_definitions
     WHERE id = ? AND (owner_organization_id IS NULL OR owner_organization_id = ?)`,
    )
    .get(sectionTemplateId, organizationId);
  if (!definition) return null;
  return toResolved(
    organizationId,
    definition,
    overrideMap(organizationId).get(definition.id),
    userCustomMap(userId).get(definition.key),
  );
}

export function listMeetingStructures(
  organizationId: number,
  userId?: number,
  includeInactive = false,
): MeetingStructure[] {
  const rows = db
    .query<StructureRow, [number]>(
      `SELECT id, organization_id, base_template_id, slug, name, description, meeting_body, is_annual, is_default, is_active
     FROM meeting_structures
     WHERE organization_id = ? ${includeInactive ? "" : "AND is_active = 1"}
     ORDER BY is_default DESC, name COLLATE NOCASE, id`,
    )
    .all(organizationId);
  return rows
    .map((row) => getMeetingStructure(row.id, userId))
    .filter((row): row is MeetingStructure => row != null);
}

export function getMeetingStructure(id: number, userId?: number): MeetingStructure | null {
  const row = db
    .query<StructureRow, [number]>(
      `SELECT id, organization_id, base_template_id, slug, name, description, meeting_body, is_annual, is_default, is_active
     FROM meeting_structures WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;
  const sectionRows = db
    .query<{ section_template_id: number }, [number]>(
      `SELECT section_template_id
     FROM meeting_structure_sections
     WHERE meeting_structure_id = ?
     ORDER BY ordinal`,
    )
    .all(id);
  const sections = sectionRows
    .map((section) =>
      resolveOrganizationSection(row.organization_id, section.section_template_id, userId),
    )
    .filter((section): section is ResolvedSectionTemplate => section != null);
  return {
    id: row.id,
    organization_id: row.organization_id,
    base_template_id: row.base_template_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    meeting_body: row.meeting_body,
    is_annual: Boolean(row.is_annual),
    is_default: Boolean(row.is_default),
    is_active: Boolean(row.is_active),
    sections,
  };
}

export function upsertOrganizationOverride(input: {
  organizationId: number;
  sectionTemplateId: number;
  title: string;
  bodyText: string;
  requiredSources?: string[];
  requiredVariables?: string[];
  userId: number;
}): ResolvedSectionTemplate | null {
  const definition = resolveOrganizationSection(input.organizationId, input.sectionTemplateId);
  if (!definition) return null;
  db.run(
    `INSERT INTO organization_section_overrides
       (organization_id, section_template_id, title, body_text, required_sources_json, required_variables_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(organization_id, section_template_id) DO UPDATE SET
       title = excluded.title,
       body_text = excluded.body_text,
       required_sources_json = excluded.required_sources_json,
       required_variables_json = excluded.required_variables_json,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`,
    [
      input.organizationId,
      input.sectionTemplateId,
      input.title,
      input.bodyText,
      JSON.stringify(input.requiredSources ?? inferRequiredSources(input.title, input.bodyText)),
      JSON.stringify(
        input.requiredVariables ?? inferRequiredVariables(input.bodyText, input.title),
      ),
      input.userId,
    ],
  );
  return resolveOrganizationSection(input.organizationId, input.sectionTemplateId);
}

export function resetOrganizationOverride(
  organizationId: number,
  sectionTemplateId: number,
): boolean {
  const result = db.run(
    "DELETE FROM organization_section_overrides WHERE organization_id = ? AND section_template_id = ?",
    [organizationId, sectionTemplateId],
  );
  return result.changes > 0;
}

function uniqueSectionKey(organizationId: number, title: string): string {
  const org = db
    .query<{ slug: string }, [number]>("SELECT slug FROM organizations WHERE id = ?")
    .get(organizationId);
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let key = `${org?.slug ?? `org-${organizationId}`}-${base}`;
  let suffix = 2;
  while (
    db
      .query<{ id: number }, [string]>("SELECT id FROM section_template_definitions WHERE key = ?")
      .get(key)
  ) {
    key = `${org?.slug ?? `org-${organizationId}`}-${base}-${suffix++}`;
  }
  return key;
}

export function createOrganizationSection(input: {
  organizationId: number;
  title: string;
  bodyText: string;
  requiredSources?: string[];
  requiredVariables?: string[];
}): ResolvedSectionTemplate {
  const key = uniqueSectionKey(input.organizationId, input.title);
  const result = db.run(
    `INSERT INTO section_template_definitions
       (key, owner_organization_id, title, body_text, required_sources_json, required_variables_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      key,
      input.organizationId,
      input.title,
      input.bodyText,
      JSON.stringify(input.requiredSources ?? inferRequiredSources(input.title, input.bodyText)),
      JSON.stringify(
        input.requiredVariables ?? inferRequiredVariables(input.bodyText, input.title),
      ),
    ],
  );
  return resolveOrganizationSection(input.organizationId, Number(result.lastInsertRowid))!;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "meeting"
  );
}

function uniqueStructureSlug(organizationId: number, name: string): string {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (
    db
      .query<{ id: number }, [number, string]>(
        "SELECT id FROM meeting_structures WHERE organization_id = ? AND slug = ?",
      )
      .get(organizationId, slug)
  )
    slug = `${base}-${suffix++}`;
  return slug;
}

function replaceStructureSections(
  structureId: number,
  organizationId: number,
  sectionTemplateIds: number[],
): void {
  const uniqueIds = [...new Set(sectionTemplateIds)];
  for (const id of uniqueIds) {
    if (!resolveOrganizationSection(organizationId, id))
      throw new Error(`Section template ${id} is not available to this organization`);
  }
  const insert = db.prepare(
    "INSERT INTO meeting_structure_sections (meeting_structure_id, section_template_id, ordinal) VALUES (?, ?, ?)",
  );
  const transaction = db.transaction(() => {
    db.run("DELETE FROM meeting_structure_sections WHERE meeting_structure_id = ?", [structureId]);
    uniqueIds.forEach((id, index) => insert.run(structureId, id, index + 1));
  });
  transaction();
}

export function createMeetingStructure(input: {
  organizationId: number;
  name: string;
  description?: string;
  meetingBody?: string;
  isAnnual?: boolean;
  baseTemplateId?: number;
  copyFromStructureId?: number;
  sectionTemplateIds?: number[];
}): MeetingStructure {
  const copied = input.copyFromStructureId ? getMeetingStructure(input.copyFromStructureId) : null;
  const baseTemplateId = input.baseTemplateId ?? copied?.base_template_id;
  if (
    !baseTemplateId ||
    !db
      .query<{ id: number }, [number]>("SELECT id FROM meeting_templates WHERE id = ?")
      .get(baseTemplateId)
  ) {
    throw new Error("A valid document layout is required");
  }
  const count =
    db
      .query<{ count: number }, [number]>(
        "SELECT count(*) AS count FROM meeting_structures WHERE organization_id = ?",
      )
      .get(input.organizationId)?.count ?? 0;
  const result = db.run(
    `INSERT INTO meeting_structures
       (organization_id, base_template_id, slug, name, description, meeting_body, is_annual, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.organizationId,
      baseTemplateId,
      uniqueStructureSlug(input.organizationId, input.name),
      input.name,
      input.description ?? copied?.description ?? "",
      input.meetingBody ?? copied?.meeting_body ?? "",
      (input.isAnnual ?? copied?.is_annual ?? false) ? 1 : 0,
      count === 0 ? 1 : 0,
    ],
  );
  const id = Number(result.lastInsertRowid);
  const sectionIds =
    input.sectionTemplateIds ??
    copied?.sections
      .map((section) => section.section_template_id)
      .filter((value): value is number => value != null) ??
    [];
  replaceStructureSections(id, input.organizationId, sectionIds);
  return getMeetingStructure(id)!;
}

export function updateMeetingStructure(input: {
  id: number;
  name?: string;
  description?: string;
  meetingBody?: string;
  isAnnual?: boolean;
  baseTemplateId?: number;
  isDefault?: boolean;
  isActive?: boolean;
  sectionTemplateIds?: number[];
}): MeetingStructure | null {
  const existing = getMeetingStructure(input.id);
  if (!existing) return null;
  if (
    input.baseTemplateId &&
    !db
      .query<{ id: number }, [number]>("SELECT id FROM meeting_templates WHERE id = ?")
      .get(input.baseTemplateId)
  ) {
    throw new Error("Document layout not found");
  }
  const transaction = db.transaction(() => {
    if (input.isDefault)
      db.run("UPDATE meeting_structures SET is_default = 0 WHERE organization_id = ?", [
        existing.organization_id,
      ]);
    db.run(
      `UPDATE meeting_structures SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         meeting_body = COALESCE(?, meeting_body),
         is_annual = COALESCE(?, is_annual),
         base_template_id = COALESCE(?, base_template_id),
         is_default = COALESCE(?, is_default),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        input.name?.trim() || null,
        input.description ?? null,
        input.meetingBody ?? null,
        input.isAnnual == null ? null : input.isAnnual ? 1 : 0,
        input.baseTemplateId ?? null,
        input.isDefault == null ? null : input.isDefault ? 1 : 0,
        input.isActive == null ? null : input.isActive ? 1 : 0,
        input.id,
      ],
    );
    if (input.sectionTemplateIds)
      replaceStructureSections(input.id, existing.organization_id, input.sectionTemplateIds);
  });
  transaction();
  return getMeetingStructure(input.id);
}
