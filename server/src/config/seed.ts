import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { parseTemplate } from "../services/template-parser.ts";

async function seedAdmin(): Promise<void> {
  const configuredEmail = env.adminEmail.trim().toLowerCase();
  const existing = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE lower(email) = ?")
    .get(configuredEmail);
  if (existing) return;
  const superAdmin = db.query<{ id: number }, []>("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get();
  if (superAdmin && ["admin", "udgam", "udgam@jkp.org.in"].includes(configuredEmail)) return;
  const hash = await Bun.password.hash(env.adminPassword);
  db.run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')", [
    configuredEmail,
    hash,
  ]);
  console.log(`[seed] admin user created: ${configuredEmail}`);
}

async function seedUsers(): Promise<void> {
  const users: Array<{ email: string; aliases: string[]; password: string; role: string }> = [
    { email: "udgam@jkp.org.in", aliases: ["admin", "udgam"], password: env.adminPassword, role: "super_admin" },
    { email: "dalpana@jkp.org.in", aliases: ["dalpana"], password: "gurudham1922", role: "admin" },
  ];
  for (const u of users) {
    const existing = db.query<{ id: number }, [string]>("SELECT id FROM users WHERE lower(email) = ?")
      .get(u.email);
    if (existing) continue;
    const alias = db.query<{ id: number }, string[]>(
      `SELECT id FROM users WHERE lower(email) IN (${u.aliases.map(() => "?").join(",")}) ORDER BY id LIMIT 1`,
    ).get(...u.aliases);
    if (alias) {
      db.run("UPDATE users SET email = ?, role = ?, updated_at = datetime('now') WHERE id = ?", [u.email, u.role, alias.id]);
      continue;
    }
    const hash = await Bun.password.hash(u.password);
    db.run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)", [
      u.email,
      hash,
      u.role,
    ]);
    console.log(`[seed] user created: ${u.email}`);
  }
}

function seedOrganizations(): void {
  const orgs = [{ slug: "jkp", name: "Jagadguru Kripalu Parishat — Bhakti Dham" }];
  for (const o of orgs) {
    const existing = db.query<{ id: number }, [string]>(
      "SELECT id FROM organizations WHERE slug = ?",
    ).get(o.slug);
    if (existing) continue;
    db.run("INSERT INTO organizations (slug, name) VALUES (?, ?)", [o.slug, o.name]);
    console.log(`[seed] organization created: ${o.slug}`);
  }
}

async function seedTemplates(): Promise<void> {
  const templatesRoot = resolve(process.cwd(), "templates");
  if (!existsSync(templatesRoot)) return;

  for (const orgSlug of readdirSync(templatesRoot)) {
    const orgDir = join(templatesRoot, orgSlug);
    if (!statSync(orgDir).isDirectory()) continue;
    const org = db.query<{ id: number }, [string]>(
      "SELECT id FROM organizations WHERE slug = ?",
    ).get(orgSlug);
    if (!org) continue;

    for (const f of readdirSync(orgDir)) {
      if (!f.endsWith(".docx")) continue;
      const slug = basename(f, ".docx");
      const existing = db.query<{ id: number }, [number, string]>(
        "SELECT id FROM meeting_templates WHERE organization_id = ? AND slug = ?",
      ).get(org.id, slug);
      if (existing) continue;

      const docxPath = join(orgDir, f);
      const parsed = await parseTemplate(docxPath);
      db.run(
        `INSERT INTO meeting_templates (organization_id, slug, title, docx_path, parsed_json)
         VALUES (?, ?, ?, ?, ?)`,
        [org.id, slug, parsed.title, docxPath, JSON.stringify(parsed)],
      );
      console.log(`[seed] template registered: ${orgSlug}/${slug} (${parsed.sections.length} sections)`);
    }
  }
}

export async function runSeeders(): Promise<void> {
  await seedUsers();
  await seedAdmin();
  seedOrganizations();
  await seedTemplates();
}
