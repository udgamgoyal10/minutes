import { Hono } from "hono";
import { db } from "../config/db.ts";
import { isAdminRole, isSuperAdmin, requireAuth } from "../middleware/auth.ts";
import {
  createMeetingStructure,
  createOrganizationSection,
  getMeetingStructure,
  listMeetingStructures,
  listOrganizationSections,
  listSharedSections,
  resetOrganizationOverride,
  updateMeetingStructure,
  updateSharedSection,
  upsertOrganizationOverride,
} from "../services/organization-templates.ts";

const r = new Hono();
r.use("*", requireAuth);

function organizationExists(id: number): boolean {
  return Boolean(db.query<{ id: number }, [number]>("SELECT id FROM organizations WHERE id = ?").get(id));
}

function requireAdmin(role: string): boolean {
  return isAdminRole(role);
}

r.post("/organizations", async (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({})) as Partial<{ name: string; slug: string }>;
  const name = body.name?.trim() ?? "";
  const slug = (body.slug?.trim() || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name || !slug) return c.json({ error: "organization name required" }, 400);
  if (db.query<{ id: number }, [string]>("SELECT id FROM organizations WHERE slug = ?").get(slug)) {
    return c.json({ error: "organization already exists" }, 409);
  }
  const result = db.run("INSERT INTO organizations (slug, name) VALUES (?, ?)", [slug, name]);
  return c.json({ organization: { id: Number(result.lastInsertRowid), slug, name } }, 201);
});

r.patch("/organizations/:id", async (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Partial<{ name: string }>;
  const name = body.name?.trim();
  if (!name) return c.json({ error: "organization name required" }, 400);
  const result = db.run("UPDATE organizations SET name = ? WHERE id = ?", [name, id]);
  if (!result.changes) return c.json({ error: "organization not found" }, 404);
  const organization = db.query<{ id: number; slug: string; name: string }, [number]>(
    "SELECT id, slug, name FROM organizations WHERE id = ?",
  ).get(id);
  return c.json({ organization });
});

r.get("/shared-section-templates", (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  return c.json({ sections: listSharedSections() });
});

r.put("/shared-section-templates/:sectionTemplateId", async (c) => {
  const user = c.get("user");
  if (!isSuperAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const sectionTemplateId = Number(c.req.param("sectionTemplateId"));
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
  }>;
  const title = body.title?.trim() ?? "";
  if (!title) return c.json({ error: "title required" }, 400);
  const section = updateSharedSection({
    sectionTemplateId,
    title,
    bodyText: body.body_text ?? "",
    requiredSources: body.required_sources,
    requiredVariables: body.required_variables,
  });
  if (!section) return c.json({ error: "shared section template not found" }, 404);
  return c.json({ section });
});

r.get("/organizations/:id/section-templates", (c) => {
  const user = c.get("user");
  const organizationId = Number(c.req.param("id"));
  if (!organizationExists(organizationId)) return c.json({ error: "organization not found" }, 404);
  return c.json({ sections: listOrganizationSections(organizationId, user.id) });
});

r.post("/organizations/:id/section-templates", async (c) => {
  const user = c.get("user");
  if (!requireAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const organizationId = Number(c.req.param("id"));
  if (!organizationExists(organizationId)) return c.json({ error: "organization not found" }, 404);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
  }>;
  const title = body.title?.trim() ?? "";
  if (!title) return c.json({ error: "title required" }, 400);
  const section = createOrganizationSection({
    organizationId,
    title,
    bodyText: body.body_text ?? "",
    requiredSources: body.required_sources,
    requiredVariables: body.required_variables,
  });
  return c.json({ section }, 201);
});

r.put("/organizations/:id/section-templates/:sectionTemplateId", async (c) => {
  const user = c.get("user");
  if (!requireAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const organizationId = Number(c.req.param("id"));
  const sectionTemplateId = Number(c.req.param("sectionTemplateId"));
  const body = await c.req.json().catch(() => ({})) as Partial<{
    title: string;
    body_text: string;
    required_sources: string[];
    required_variables: string[];
  }>;
  const title = body.title?.trim() ?? "";
  if (!title) return c.json({ error: "title required" }, 400);
  const section = upsertOrganizationOverride({
    organizationId,
    sectionTemplateId,
    title,
    bodyText: body.body_text ?? "",
    requiredSources: body.required_sources,
    requiredVariables: body.required_variables,
    userId: user.id,
  });
  if (!section) return c.json({ error: "section template not found" }, 404);
  return c.json({ section });
});

r.delete("/organizations/:id/section-templates/:sectionTemplateId/override", (c) => {
  const user = c.get("user");
  if (!requireAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const organizationId = Number(c.req.param("id"));
  const sectionTemplateId = Number(c.req.param("sectionTemplateId"));
  resetOrganizationOverride(organizationId, sectionTemplateId);
  const section = listOrganizationSections(organizationId, user.id)
    .find((item) => item.section_template_id === sectionTemplateId) ?? null;
  return c.json({ section });
});

r.get("/meeting-structures", (c) => {
  const user = c.get("user");
  const organizationId = Number(c.req.query("organization_id"));
  if (!organizationId || !organizationExists(organizationId)) return c.json({ error: "valid organization_id required" }, 400);
  return c.json({ structures: listMeetingStructures(organizationId, user.id, isAdminRole(user.role)) });
});

r.get("/meeting-structures/:id", (c) => {
  const user = c.get("user");
  const structure = getMeetingStructure(Number(c.req.param("id")), user.id);
  if (!structure) return c.json({ error: "meeting structure not found" }, 404);
  return c.json({ structure });
});

r.post("/meeting-structures", async (c) => {
  const user = c.get("user");
  if (!requireAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json().catch(() => ({})) as Partial<{
    organization_id: number;
    name: string;
    description: string;
    base_template_id: number;
    copy_from_structure_id: number;
    section_template_ids: number[];
  }>;
  const organizationId = Number(body.organization_id);
  const name = body.name?.trim() ?? "";
  if (!organizationId || !organizationExists(organizationId)) return c.json({ error: "valid organization required" }, 400);
  if (!name) return c.json({ error: "meeting type name required" }, 400);
  try {
    const structure = createMeetingStructure({
      organizationId,
      name,
      description: body.description,
      baseTemplateId: body.base_template_id,
      copyFromStructureId: body.copy_from_structure_id,
      sectionTemplateIds: body.section_template_ids,
    });
    return c.json({ structure }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

r.patch("/meeting-structures/:id", async (c) => {
  const user = c.get("user");
  if (!requireAdmin(user.role)) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Partial<{
    name: string;
    description: string;
    base_template_id: number;
    is_default: boolean;
    is_active: boolean;
    section_template_ids: number[];
  }>;
  try {
    const structure = updateMeetingStructure({
      id,
      name: body.name,
      description: body.description,
      baseTemplateId: body.base_template_id,
      isDefault: body.is_default,
      isActive: body.is_active,
      sectionTemplateIds: body.section_template_ids,
    });
    if (!structure) return c.json({ error: "meeting structure not found" }, 404);
    return c.json({ structure });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

export default r;
