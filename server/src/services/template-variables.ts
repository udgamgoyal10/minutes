import type { Placeholder } from "./template-parser.ts";

export const ADDITIONAL_TEMPLATE_VARIABLES = [
  "Daan Peti Individual 1",
  "Daan Peti Individual 2",
  "Daan Peti Individual 3",
  "Daan Peti Individual 4",
  "Construction Site in Charge",
  "Income Tax Representative",
  "Caretaker of Livestock",
  "Caretaker of Agriculture",
] as const;

const HIDDEN_TEMPLATE_VARIABLES = new Set([
  "date-1",
  "previous-meeting-date",
  "date-2",
  "this-meeting-date",
  "location",
  "day",
  "month",
  "year",
]);

const TRUSTEE_1_TOKEN = "trustee-1";

export function slugifyVariable(s: string): string {
  return s
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function canonicalPlaceholder(raw: string): Placeholder | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 2) return null;
  if (/^[/!?]/.test(trimmed)) return null;
  if (/^[A-Z][A-Za-z0-9]*\s*[/=]/.test(trimmed)) return null;
  const token = canonicalToken(trimmed);
  if (HIDDEN_TEMPLATE_VARIABLES.has(token)) return null;
  return { token, raw: canonicalRaw(trimmed) };
}

export function canonicalToken(raw: string): string {
  const token = slugifyVariable(raw);
  if (token === "trustee-1-aka-managing-trustee") return TRUSTEE_1_TOKEN;
  if (token === "managing-trustee") return TRUSTEE_1_TOKEN;
  return token;
}

export function canonicalRaw(raw: string): string {
  if (canonicalToken(raw) === TRUSTEE_1_TOKEN) return "Trustee 1 / Managing Trustee";
  return raw.trim();
}

export function mergePlaceholders(placeholders: Placeholder[]): Placeholder[] {
  const out = new Map<string, Placeholder>();
  for (const placeholder of placeholders) {
    if (!out.has(placeholder.token)) out.set(placeholder.token, placeholder);
  }
  return [...out.values()];
}

export function setupPlaceholders(globalPlaceholders: Placeholder[], allPlaceholders: Placeholder[]): Placeholder[] {
  const additional = ADDITIONAL_TEMPLATE_VARIABLES.map((raw) => canonicalPlaceholder(raw)).filter(
    (p): p is Placeholder => p != null,
  );
  return mergePlaceholders([...globalPlaceholders, ...allPlaceholders.filter((p) => additional.some((a) => a.token === p.token)), ...additional]);
}

export function buildTemplateVariables(args: {
  variables: Record<string, string>;
  meetingDate?: string | null;
  previousMeetingDate?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args.variables)) {
    out[canonicalToken(key)] = value;
  }
  const previous = formatDate(args.previousMeetingDate);
  const current = formatDate(args.meetingDate);
  if (previous) {
    out["date-1"] = previous;
    out["previous-meeting-date"] = previous;
  }
  if (current) {
    out["date-2"] = current;
    out["this-meeting-date"] = current;
    const parts = dateParts(args.meetingDate);
    if (parts) {
      out.day = parts.day;
      out.month = parts.month;
      out.year = parts.year;
    }
  }
  return out;
}

export function fillTemplateText(text: string, variables: Record<string, string>): string {
  return text.replace(/<([^<>\n]{2,200}?)>/g, (full, raw: string) => {
    const value = variables[canonicalToken(raw)];
    return value != null && value !== "" ? value : full;
  });
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `${Number(m[3])} ${d.toLocaleString("en-IN", { month: "long", timeZone: "Asia/Kolkata" })} ${m[1]}`;
}

function dateParts(value?: string | null): { day: string; month: string; year: string } | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: ordinalDay(m[3]),
    month: d.toLocaleString("en-IN", { month: "long", timeZone: "Asia/Kolkata" }),
    year: m[1],
  };
}

function ordinalDay(day: string): string {
  const n = Number(day);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
