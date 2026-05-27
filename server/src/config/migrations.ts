import { db } from "./db.ts";

type Migration = { id: number; name: string; up: () => void };

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
];

export function runMigrations(): void {
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
    const tx = db.transaction(() => {
      m.up();
      db.run("INSERT INTO _migrations (id, name) VALUES (?, ?)", [m.id, m.name]);
    });
    tx();
    console.log(`[migrations] applied ${m.id} ${m.name}`);
  }
}
