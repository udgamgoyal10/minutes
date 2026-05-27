import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "./env.ts";

const sqlitePath = resolve(process.cwd(), env.sqlitePath);
mkdirSync(dirname(sqlitePath), { recursive: true });

export const db = new Database(sqlitePath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

export function nowIso(): string {
  return new Date().toISOString();
}
