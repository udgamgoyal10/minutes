// Curated, sanitized example source files bundled with the server. They give
// users a concrete reference for what each section's sources should look like.
// Files live in server/templates/examples and are mounted read-only in Docker.

import { resolve } from "node:path";

export type ExampleSource = { label: string; file: string };

export const EXAMPLE_SOURCES: Record<string, ExampleSource[]> = {
  "investment-chart": [{ label: "Investments (Sanitized)", file: "Investments (Sanitized).xlsx" }],
  "maintenance-of-livestock": [{ label: "Expenses (Sanitized)", file: "Livestock Expenses (Sanitized).xlsx" }],
  "maintenance-of-the-agricultural-fields": [{ label: "Expenses (Sanitized)", file: "Expenses (Sanitized).xlsx" }],
  "maintenance-of-agricultural-fields": [{ label: "Expenses (Sanitized)", file: "Expenses (Sanitized).xlsx" }],
  "review-of-significant-activities": [{ label: "Capital WIP (Sanitized)", file: "Capital WIP (Sanitized).xlsx" }],
  "progress-report-on-construction-projects": [{ label: "Expenses (Sanitized)", file: "Expenses (Sanitized).xlsx" }],
};

// Set of all known example filenames, used to guard against path traversal.
const ALLOWED_FILES = new Set<string>(
  Object.values(EXAMPLE_SOURCES).flatMap((list) => list.map((e) => e.file)),
);

export function exampleSourcesFor(sectionKey: string): ExampleSource[] {
  return EXAMPLE_SOURCES[sectionKey] ?? [];
}

export function exampleFilePath(file: string): string | null {
  if (!ALLOWED_FILES.has(file)) return null;
  return resolve(process.cwd(), "templates", "examples", file);
}
