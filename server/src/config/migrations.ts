import { db } from "./db.ts";
import { inferRequiredSources } from "../services/source-recommendations.ts";
import { parseTemplate, type ParsedTemplate } from "../services/template-parser.ts";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

type Migration = { id: number; name: string; up: () => void | Promise<void> };

const migrations: Migration[] = [
  {
    id: 1,
    name: "init",
    up: () => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE meeting_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          slug TEXT NOT NULL,
          title TEXT NOT NULL,
          docx_path TEXT NOT NULL,
          parsed_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(organization_id, slug)
        );

        CREATE TABLE meetings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER NOT NULL REFERENCES meeting_templates(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          meeting_date TEXT,
          previous_meeting_date TEXT,
          variables_json TEXT NOT NULL DEFAULT '{}',
          ai_provider TEXT,
          ai_model TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          label TEXT,
          original_name TEXT,
          stored_path TEXT,
          mime TEXT,
          extracted_text TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE section_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          section_key TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          title TEXT NOT NULL,
          content_md TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          last_ai_provider TEXT,
          last_ai_model TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(meeting_id, section_key)
        );

        CREATE TABLE ai_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
          section_key TEXT,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt TEXT NOT NULL,
          response TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_meetings_user ON meetings(user_id);
        CREATE INDEX idx_sources_meeting ON sources(meeting_id);
        CREATE INDEX idx_sections_meeting ON section_drafts(meeting_id);
        CREATE INDEX idx_airuns_meeting ON ai_runs(meeting_id);
      `);
    },
  },
  {
    id: 2,
    name: "section_workflow_metadata",
    up: () => {
      db.exec(`
        ALTER TABLE section_drafts ADD COLUMN mode TEXT NOT NULL DEFAULT 'template';
        ALTER TABLE section_drafts ADD COLUMN required_sources_json TEXT NOT NULL DEFAULT '[]';
      `);

      const rows = db.query<{
        meeting_id: number;
        section_key: string;
        content_md: string;
        parsed_json: string;
      }, []>(
        `SELECT s.meeting_id, s.section_key, s.content_md, t.parsed_json
         FROM section_drafts s
         JOIN meetings m ON m.id = s.meeting_id
         JOIN meeting_templates t ON t.id = m.template_id`,
      ).all();

      const update = db.prepare(
        `UPDATE section_drafts
         SET content_md = CASE WHEN content_md = '' THEN ? ELSE content_md END,
             required_sources_json = ?
         WHERE meeting_id = ? AND section_key = ?`,
      );

      const tx = db.transaction(() => {
        for (const row of rows) {
          const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
          const section = parsed.sections.find((s) => s.key === row.section_key);
          if (!section) continue;
          update.run(
            section.bodyText,
            JSON.stringify(inferRequiredSources(section.title, section.bodyText)),
            row.meeting_id,
            row.section_key,
          );
        }
      });
      tx();
    },
  },
  {
    id: 3,
    name: "refresh_section_source_recommendations",
    up: () => {
      const rows = db.query<{
        meeting_id: number;
        section_key: string;
        title: string;
        content_md: string;
        parsed_json: string;
      }, []>(
        `SELECT s.meeting_id, s.section_key, s.title, s.content_md, t.parsed_json
         FROM section_drafts s
         JOIN meetings m ON m.id = s.meeting_id
         JOIN meeting_templates t ON t.id = m.template_id`,
      ).all();

      const update = db.prepare(
        `UPDATE section_drafts
         SET required_sources_json = ?
         WHERE meeting_id = ? AND section_key = ?`,
      );

      const tx = db.transaction(() => {
        for (const row of rows) {
          const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
          const section = parsed.sections.find((s) => s.key === row.section_key);
          const title = section?.title ?? row.title;
          const bodyText = section?.bodyText ?? row.content_md;
          update.run(
            JSON.stringify(inferRequiredSources(title, bodyText)),
            row.meeting_id,
            row.section_key,
          );
        }
      });
      tx();
    },
  },
  {
    id: 4,
    name: "refresh_template_sections_from_docx",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
        parsed_json: string;
      }, []>("SELECT id, docx_path, parsed_json FROM meeting_templates").all();

      for (const template of templates) {
        const oldParsed = JSON.parse(template.parsed_json) as ParsedTemplate;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);

        const meetings = db.query<{ id: number }, [number]>(
          "SELECT id FROM meetings WHERE template_id = ?",
        ).all(template.id);

        const existingRows = db.query<{
          id: number;
          meeting_id: number;
          section_key: string;
          content_md: string;
          status: string;
          last_ai_provider: string | null;
        }, [number]>("SELECT id, meeting_id, section_key, content_md, status, last_ai_provider FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC");

        const updateExisting = db.prepare(
          `UPDATE section_drafts
           SET ordinal = ?,
               title = ?,
               content_md = ?,
               required_sources_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        );
        const insertMissing = db.prepare(
          `INSERT INTO section_drafts
             (meeting_id, section_key, ordinal, title, content_md, status, mode, required_sources_json)
           VALUES (?, ?, ?, ?, ?, 'pending', 'template', ?)`,
        );

        const tx = db.transaction(() => {
          for (const meeting of meetings) {
            const rows = existingRows.all(meeting.id);
            const byKey = new Map(rows.map((row) => [row.section_key, row]));
            for (const section of parsed.sections) {
              const oldSection = oldParsed.sections.find((s) => s.key === section.key);
              const existing = byKey.get(section.key);
              const required = JSON.stringify(inferRequiredSources(section.title, section.bodyText));
              if (existing) {
                const canReplaceContent = !existing.content_md ||
                  existing.content_md === oldSection?.bodyText ||
                  (existing.status === "pending" && !existing.last_ai_provider);
                updateExisting.run(
                  section.ordinal,
                  section.title,
                  canReplaceContent ? section.bodyText : existing.content_md,
                  required,
                  existing.id,
                );
              } else {
                insertMissing.run(
                  meeting.id,
                  section.key,
                  section.ordinal,
                  section.title,
                  section.bodyText,
                  required,
                );
              }
            }
          }
        });
        tx();
      }
    },
  },
  {
    id: 5,
    name: "tighten_section_source_recommendations",
    up: () => {
      const rows = db.query<{
        meeting_id: number;
        section_key: string;
        title: string;
        content_md: string;
      }, []>("SELECT meeting_id, section_key, title, content_md FROM section_drafts").all();

      const update = db.prepare(
        `UPDATE section_drafts
         SET required_sources_json = ?
         WHERE meeting_id = ? AND section_key = ?`,
      );

      const tx = db.transaction(() => {
        for (const row of rows) {
          update.run(
            JSON.stringify(inferRequiredSources(row.title, row.content_md)),
            row.meeting_id,
            row.section_key,
          );
        }
      });
      tx();
    },
  },
  {
    id: 6,
    name: "merge_intro_and_refresh_variables",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
        parsed_json: string;
      }, []>("SELECT id, docx_path, parsed_json FROM meeting_templates").all();

      for (const template of templates) {
        const oldParsed = JSON.parse(template.parsed_json) as ParsedTemplate;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);

        const meetings = db.query<{ id: number }, [number]>(
          "SELECT id FROM meetings WHERE template_id = ?",
        ).all(template.id);

        const selectSections = db.query<{
          id: number;
          section_key: string;
          content_md: string;
          status: string;
          mode: string;
          last_ai_provider: string | null;
        }, [number]>(
          `SELECT id, section_key, content_md, status, mode, last_ai_provider
           FROM section_drafts
           WHERE meeting_id = ?
           ORDER BY ordinal ASC`,
        );
        const updateExisting = db.prepare(
          `UPDATE section_drafts
           SET ordinal = ?,
               title = ?,
               content_md = ?,
               required_sources_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        );
        const insertMissing = db.prepare(
          `INSERT INTO section_drafts
             (meeting_id, section_key, ordinal, title, content_md, status, mode, required_sources_json)
           VALUES (?, ?, ?, ?, ?, 'pending', 'template', ?)`,
        );
        const deleteObsoleteIntro = db.prepare(
          `DELETE FROM section_drafts
           WHERE meeting_id = ?
             AND section_key IN ('notice-of-the-meeting', 'signing-of-minutes', 'approval-of-proceedings')`,
        );

        const tx = db.transaction(() => {
          for (const meeting of meetings) {
            const rows = selectSections.all(meeting.id);
            const byKey = new Map(rows.map((row) => [row.section_key, row]));
            for (const section of parsed.sections) {
              const oldSection = oldParsed.sections.find((s) => s.key === section.key);
              const existing = byKey.get(section.key);
              const introRows = section.key === "introduction"
                ? [
                  byKey.get("notice-of-the-meeting"),
                  byKey.get("signing-of-minutes"),
                  byKey.get("approval-of-proceedings"),
                ].filter((row): row is NonNullable<typeof row> => row != null)
                : [];
              const mergedIntroContent = introRows.some((row) => row.status !== "pending" || row.last_ai_provider)
                ? introRows.map((row) => row.content_md).filter(Boolean).join("\n\n")
                : section.bodyText;
              const required = JSON.stringify(inferRequiredSources(section.title, section.bodyText));
              if (existing) {
                const canReplaceContent = !existing.content_md ||
                  existing.content_md === oldSection?.bodyText ||
                  (existing.status === "pending" && !existing.last_ai_provider);
                updateExisting.run(
                  section.ordinal,
                  section.title,
                  canReplaceContent ? mergedIntroContent : existing.content_md,
                  required,
                  existing.id,
                );
              } else {
                insertMissing.run(
                  meeting.id,
                  section.key,
                  section.ordinal,
                  section.title,
                  mergedIntroContent,
                  required,
                );
              }
            }
            deleteObsoleteIntro.run(meeting.id);
          }
        });
        tx();
      }
    },
  },
  {
    id: 7,
    name: "refresh_intro_variables_and_source_map",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
        parsed_json: string;
      }, []>("SELECT id, docx_path, parsed_json FROM meeting_templates").all();

      for (const template of templates) {
        const oldParsed = JSON.parse(template.parsed_json) as ParsedTemplate;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);

        const meetings = db.query<{ id: number }, [number]>(
          "SELECT id FROM meetings WHERE template_id = ?",
        ).all(template.id);
        const selectSections = db.query<{
          id: number;
          section_key: string;
          content_md: string;
          status: string;
          last_ai_provider: string | null;
        }, [number]>(
          `SELECT id, section_key, content_md, status, last_ai_provider
           FROM section_drafts
           WHERE meeting_id = ?
           ORDER BY ordinal ASC`,
        );
        const updateExisting = db.prepare(
          `UPDATE section_drafts
           SET ordinal = ?,
               title = ?,
               content_md = ?,
               required_sources_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        );
        const insertMissing = db.prepare(
          `INSERT INTO section_drafts
             (meeting_id, section_key, ordinal, title, content_md, status, mode, required_sources_json)
           VALUES (?, ?, ?, ?, ?, 'pending', 'template', ?)`,
        );

        const tx = db.transaction(() => {
          for (const meeting of meetings) {
            const rows = selectSections.all(meeting.id);
            const byKey = new Map(rows.map((row) => [row.section_key, row]));
            for (const section of parsed.sections) {
              const oldSection = oldParsed.sections.find((s) => s.key === section.key);
              const existing = byKey.get(section.key);
              const required = JSON.stringify(inferRequiredSources(section.title, section.bodyText));
              if (existing) {
                const canReplaceContent = !existing.content_md ||
                  existing.content_md === oldSection?.bodyText ||
                  (existing.status === "pending" && !existing.last_ai_provider);
                updateExisting.run(
                  section.ordinal,
                  section.title,
                  canReplaceContent ? section.bodyText : existing.content_md,
                  required,
                  existing.id,
                );
              } else {
                insertMissing.run(
                  meeting.id,
                  section.key,
                  section.ordinal,
                  section.title,
                  section.bodyText,
                  required,
                );
              }
            }
          }
        });
        tx();
      }
    },
  },
  {
    id: 8,
    name: "refresh_maintenance_source_recommendations",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
      }, []>("SELECT id, docx_path FROM meeting_templates").all();

      for (const template of templates) {
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);
      }

      const rows = db.query<{
        id: number;
        title: string;
        content_md: string;
      }, []>("SELECT id, title, content_md FROM section_drafts").all();
      const update = db.prepare("UPDATE section_drafts SET required_sources_json = ?, updated_at = datetime('now') WHERE id = ?");
      const tx = db.transaction(() => {
        for (const row of rows) {
          update.run(JSON.stringify(inferRequiredSources(row.title, row.content_md)), row.id);
        }
      });
      tx();
    },
  },
  {
    id: 9,
    name: "register_meeting_2_template",
    up: async () => {
      const org = db.query<{ id: number }, [string]>(
        "SELECT id FROM organizations WHERE slug = ?",
      ).get("jkp");
      if (!org) return;

      const templatePaths = [
        resolve(process.cwd(), "templates", "jkp", "meeting-1.docx"),
        resolve(process.cwd(), "templates", "jkp", "meeting-2.docx"),
      ];

      for (const docxPath of templatePaths) {
        if (!existsSync(docxPath)) continue;
        const slug = basename(docxPath, ".docx");
        const parsed = await parseTemplate(docxPath);
        const existing = db.query<{ id: number }, [number, string]>(
          "SELECT id FROM meeting_templates WHERE organization_id = ? AND slug = ?",
        ).get(org.id, slug);
        if (existing) {
          db.run(
            "UPDATE meeting_templates SET title = ?, docx_path = ?, parsed_json = ? WHERE id = ?",
            [parsed.title, docxPath, JSON.stringify(parsed), existing.id],
          );
        } else {
          db.run(
            `INSERT INTO meeting_templates (organization_id, slug, title, docx_path, parsed_json)
             VALUES (?, ?, ?, ?, ?)`,
            [org.id, slug, parsed.title, docxPath, JSON.stringify(parsed)],
          );
        }
      }

      const rows = db.query<{
        id: number;
        title: string;
        content_md: string;
      }, []>("SELECT id, title, content_md FROM section_drafts").all();
      const update = db.prepare("UPDATE section_drafts SET required_sources_json = ?, updated_at = datetime('now') WHERE id = ?");
      const tx = db.transaction(() => {
        for (const row of rows) {
          update.run(JSON.stringify(inferRequiredSources(row.title, row.content_md)), row.id);
        }
      });
      tx();
    },
  },
  {
    id: 10,
    name: "section_template_body_text",
    up: () => {
      db.exec("ALTER TABLE section_drafts ADD COLUMN template_body_text TEXT NOT NULL DEFAULT '';");
      const rows = db.query<{
        id: number;
        section_key: string;
        content_md: string;
        parsed_json: string;
      }, []>(
        `SELECT s.id, s.section_key, s.content_md, t.parsed_json
         FROM section_drafts s
         JOIN meetings m ON m.id = s.meeting_id
         JOIN meeting_templates t ON t.id = m.template_id`,
      ).all();
      const update = db.prepare(
        "UPDATE section_drafts SET template_body_text = ? WHERE id = ?",
      );
      const tx = db.transaction(() => {
        for (const row of rows) {
          const parsed = JSON.parse(row.parsed_json) as ParsedTemplate;
          const section = parsed.sections.find((s) => s.key === row.section_key);
          update.run(section?.bodyText ?? row.content_md, row.id);
        }
      });
      tx();
    },
  },
  {
    id: 11,
    name: "refresh_templates_v3",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
        parsed_json: string;
      }, []>("SELECT id, docx_path, parsed_json FROM meeting_templates").all();

      for (const template of templates) {
        if (!existsSync(template.docx_path)) continue;
        const oldParsed = JSON.parse(template.parsed_json) as ParsedTemplate;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);

        const meetings = db.query<{ id: number }, [number]>(
          "SELECT id FROM meetings WHERE template_id = ?",
        ).all(template.id);

        const existingStmt = db.query<{
          id: number;
          meeting_id: number;
          section_key: string;
          content_md: string;
          template_body_text: string;
          status: string;
          last_ai_provider: string | null;
        }, [number]>(
          "SELECT id, meeting_id, section_key, content_md, template_body_text, status, last_ai_provider FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
        );

        const updateExisting = db.prepare(
          `UPDATE section_drafts
           SET ordinal = ?,
               title = ?,
               content_md = ?,
               template_body_text = ?,
               required_sources_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        );
        const insertMissing = db.prepare(
          `INSERT INTO section_drafts
             (meeting_id, section_key, ordinal, title, content_md, template_body_text, status, mode, required_sources_json)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'template', ?)`,
        );

        const tx = db.transaction(() => {
          for (const meeting of meetings) {
            const rows = existingStmt.all(meeting.id);
            const byKey = new Map(rows.map((row) => [row.section_key, row]));
            for (const section of parsed.sections) {
              const existing = byKey.get(section.key);
              const oldSection = oldParsed.sections.find((s) => s.key === section.key);
              const required = JSON.stringify(inferRequiredSources(section.title, section.bodyText));
              if (existing) {
                const canReplaceContent = !existing.content_md ||
                  existing.content_md === oldSection?.bodyText ||
                  existing.content_md === existing.template_body_text ||
                  (existing.status === "pending" && !existing.last_ai_provider);
                updateExisting.run(
                  section.ordinal,
                  section.title,
                  canReplaceContent ? section.bodyText : existing.content_md,
                  section.bodyText,
                  required,
                  existing.id,
                );
              } else {
                insertMissing.run(
                  meeting.id,
                  section.key,
                  section.ordinal,
                  section.title,
                  section.bodyText,
                  section.bodyText,
                  required,
                );
              }
            }
          }
        });
        tx();
      }
    },
  },
  {
    id: 12,
    name: "register_meeting_3_template",
    up: async () => {
      const org = db.query<{ id: number }, [string]>(
        "SELECT id FROM organizations WHERE slug = ?",
      ).get("jkp");
      if (!org) return;

      const docxPath = resolve(process.cwd(), "templates", "jkp", "meeting-3.docx");
      if (!existsSync(docxPath)) return;
      const slug = basename(docxPath, ".docx");
      const parsed = await parseTemplate(docxPath);
      const existing = db.query<{ id: number }, [number, string]>(
        "SELECT id FROM meeting_templates WHERE organization_id = ? AND slug = ?",
      ).get(org.id, slug);
      if (existing) {
        db.run(
          "UPDATE meeting_templates SET title = ?, docx_path = ?, parsed_json = ? WHERE id = ?",
          [parsed.title, docxPath, JSON.stringify(parsed), existing.id],
        );
      } else {
        db.run(
          `INSERT INTO meeting_templates (organization_id, slug, title, docx_path, parsed_json)
           VALUES (?, ?, ?, ?, ?)`,
          [org.id, slug, parsed.title, docxPath, JSON.stringify(parsed)],
        );
      }
    },
  },
  {
    id: 13,
    name: "refresh_templates_v4_and_sources",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
      }, []>("SELECT id, docx_path FROM meeting_templates").all();
      for (const template of templates) {
        if (!existsSync(template.docx_path)) continue;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);
      }

      const rows = db.query<{
        id: number;
        title: string;
        content_md: string;
      }, []>("SELECT id, title, content_md FROM section_drafts").all();
      const update = db.prepare(
        "UPDATE section_drafts SET required_sources_json = ?, updated_at = datetime('now') WHERE id = ?",
      );
      const tx = db.transaction(() => {
        for (const row of rows) {
          update.run(JSON.stringify(inferRequiredSources(row.title, row.content_md)), row.id);
        }
      });
      tx();
    },
  },
  {
    id: 14,
    name: "refresh_templates_v5_rosa_boilerplate",
    up: async () => {
      const templates = db.query<{
        id: number;
        docx_path: string;
        parsed_json: string;
      }, []>("SELECT id, docx_path, parsed_json FROM meeting_templates").all();

      for (const template of templates) {
        if (!existsSync(template.docx_path)) continue;
        const oldParsed = JSON.parse(template.parsed_json) as ParsedTemplate;
        const parsed = await parseTemplate(template.docx_path);
        db.run("UPDATE meeting_templates SET title = ?, parsed_json = ? WHERE id = ?", [
          parsed.title,
          JSON.stringify(parsed),
          template.id,
        ]);

        const meetings = db.query<{ id: number }, [number]>(
          "SELECT id FROM meetings WHERE template_id = ?",
        ).all(template.id);

        const existingStmt = db.query<{
          id: number;
          meeting_id: number;
          section_key: string;
          content_md: string;
          template_body_text: string;
          status: string;
          last_ai_provider: string | null;
        }, [number]>(
          "SELECT id, meeting_id, section_key, content_md, template_body_text, status, last_ai_provider FROM section_drafts WHERE meeting_id = ? ORDER BY ordinal ASC",
        );

        const updateExisting = db.prepare(
          `UPDATE section_drafts
           SET title = ?,
               content_md = ?,
               template_body_text = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        );

        const tx = db.transaction(() => {
          for (const meeting of meetings) {
            const rows = existingStmt.all(meeting.id);
            const byKey = new Map(rows.map((row) => [row.section_key, row]));
            for (const section of parsed.sections) {
              const existing = byKey.get(section.key);
              if (!existing) continue;
              const oldSection = oldParsed.sections.find((s) => s.key === section.key);
              const canReplaceContent = !existing.content_md ||
                existing.content_md === oldSection?.bodyText ||
                existing.content_md === existing.template_body_text ||
                (existing.status === "pending" && !existing.last_ai_provider);
              updateExisting.run(
                section.title,
                canReplaceContent ? section.bodyText : existing.content_md,
                section.bodyText,
                existing.id,
              );
            }
          }
        });
        tx();
      }
    },
  },
];

export async function runMigrations(): Promise<void> {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const applied = new Set(
    db.query<{ id: number }, []>("SELECT id FROM _migrations").all().map((r) => r.id),
  );

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await m.up();
    db.run("INSERT INTO _migrations (id, name) VALUES (?, ?)", [m.id, m.name]);
    console.log(`[migrations] applied ${m.id} ${m.name}`);
  }
}
