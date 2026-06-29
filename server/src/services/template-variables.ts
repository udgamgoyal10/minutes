import type { Placeholder } from "./template-parser.ts";

// Variables that are always shown on the setup page for every new meeting,
// regardless of which sections are currently selected. These identify the
// trust and its office bearers and are needed by nearly every section.
export const REQUIRED_TEMPLATE_VARIABLES: Array<{ token: string; raw: string }> = [
  { token: "trust-name", raw: "Trust Name" },
  { token: "trustee-1", raw: "Trustee 1 / Managing Trustee" },
  { token: "trustee-2", raw: "Trustee 2" },
  { token: "trustee-3", raw: "Trustee 3" },
  { token: "secretary", raw: "Secretary" },
  { token: "treasurer", raw: "Treasurer" },
];

export const ADDITIONAL_TEMPLATE_VARIABLES = [
  "Daan Peti Individual 1",
  "Daan Peti Individual 2",
  "Daan Peti Individual 3",
  "Daan Peti Individual 4",
  "Construction Site in Charge",
  "Income Tax Representative",
  "Caretaker of Livestock",
  "Caretaker of Agriculture",
  "Caretaker of Gardens",
  "Administrator of JKP Education",
  "Date of Janmashtami",
  "Medical Superintendent of JKC Mangarh",
  "Financial Year (e.g. 19-20)",
  "Managing Trustee Gender",
  "Managing Trustee Subject Pronoun",
  "Managing Trustee Object Pronoun",
  "Managing Trustee Possessive Pronoun",
  "Secretary Gender",
  "Secretary Subject Pronoun",
  "Secretary Object Pronoun",
  "Secretary Possessive Pronoun",
  "Treasurer Gender",
  "Treasurer Subject Pronoun",
  "Treasurer Object Pronoun",
  "Treasurer Possessive Pronoun",
  "Income Tax Representative Gender",
  "Income Tax Representative Subject Pronoun",
  "Income Tax Representative Object Pronoun",
  "Income Tax Representative Possessive Pronoun",
  "Medical Superintendent Gender",
  "Medical Superintendent Subject Pronoun",
  "Medical Superintendent Object Pronoun",
  "Medical Superintendent Possessive Pronoun",
] as const;

// Explicit per-section variable additions keyed by normalized section title.
// Used for variables a section logically needs but which do NOT appear as a
// literal <placeholder> in the template body (e.g. the gardens caretaker).
const SECTION_VARIABLE_MAP: Record<string, string[]> = {
  "maintenance-of-gardens": ["caretaker-of-gardens"],
  "maintenance-of-gardens-amra-vatika-bhakti-kunj-and-all-other-gardens": ["caretaker-of-gardens"],
  "maintenance-of-gardens-amra-vatika-bhakti-kunj-and-all-the-other-gardens": ["caretaker-of-gardens"],
  "free-distribution-program-for-underprivileged-school-children-and-poor-people": ["administrator-of-jkp-education"],
};

// Tokens whose value is a single date the user picks; rendered as a formatted
// date string (e.g. "5 September 2024") rather than expanded into day/month/year.
export const SIMPLE_DATE_TOKENS = new Set(["date-of-janmashtami"]);

// Variables that the user fills in as a single date; the day/month/year
// placeholders inside the template body are derived automatically from it.
export const DATE_TEMPLATE_VARIABLES: Array<{
  token: string;
  raw: string;
  dayToken: string;
  monthToken: string;
  yearToken: string;
}> = [
  {
    token: "adoption-of-annual-accounts-date",
    raw: "Adoption of Annual Accounts Date",
    dayToken: "adoption-of-annual-accounts-day",
    monthToken: "adoption-of-annual-accounts-month",
    yearToken: "adoption-of-annual-accounts-year",
  },
];

const HIDDEN_TEMPLATE_VARIABLES = new Set([
  "date-1",
  "previous-meeting-date",
  "date-2",
  "this-meeting-date",
  "location",
  "day",
  "month",
  "year",
  // Meeting-dates cover page (page 1) — managed via the Previous/This meeting
  // date inputs and stripped from the export.
  "meeting-date-1",
  "meeting-date-2",
  "meeting-date-3",
  "meeting-date-4",
  "meeting-date-5",
  "meeting-date-1-location",
  "meeting-date-2-location",
  "meeting-date-3-location",
  "meeting-date-4-location",
  "meeting-date-5-location",
  // Adoption-of-annual-accounts day/month/year are derived from the
  // consolidated "Adoption of Annual Accounts Date" variable.
  "adoption-of-annual-accounts-day",
  "adoption-of-annual-accounts-month",
  "adoption-of-annual-accounts-year",
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
  const token = canonicalToken(trimmed);
  if (/^[A-Z][A-Za-z0-9]*\s*[/=]/.test(trimmed) && !token.endsWith("-pronoun")) return null;
  if (HIDDEN_TEMPLATE_VARIABLES.has(token)) return null;
  return { token, raw: canonicalRaw(trimmed) };
}

export function canonicalToken(raw: string): string {
  const token = slugifyVariable(raw);
  if (token === "trustee-1-aka-managing-trustee") return TRUSTEE_1_TOKEN;
  if (token === "managing-trustee") return TRUSTEE_1_TOKEN;
  if (token === "he-she" || token === "she-he") return "managing-trustee-subject-pronoun";
  if (token === "him-her" || token === "her-him") return "managing-trustee-object-pronoun";
  if (token === "his-her" || token === "her-his") return "managing-trustee-possessive-pronoun";
  if (token === "day-of-month") return "day";
  if (token === "year-of-meeting") return "year";
  // "Approval of Annual Accounts" templates reference the adoption year using a
  // different phrasing; unify it onto the adoption-of-annual-accounts year so it
  // is filled from the same setup date.
  if (token === "year-of-adoption-of-annual-accounts") return "adoption-of-annual-accounts-year";
  if (token === "administrator-of-jagadguru-kripalu-parishat-education-in-kunda") return "administrator-of-jkp-education";
  if (token === "administrator-of-jkp-education-in-kunda") return "administrator-of-jkp-education";
  // Any "Financial Year (e.g. …)" phrasing collapses to a single variable.
  if (token.startsWith("financial-year")) return "financial-year";
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
  const dateVars: Placeholder[] = DATE_TEMPLATE_VARIABLES.map((d) => ({
    token: d.token,
    raw: d.raw,
    kind: "date",
  }));
  // Mark simple-date additional variables (e.g. Date of Janmashtami) as dates.
  const additionalTyped = additional.map((p) =>
    SIMPLE_DATE_TOKENS.has(p.token) ? { ...p, kind: "date" as const } : p,
  );
  // Required variables always lead the list and carry the `required` flag so the
  // setup page can always surface them, even when no section references them.
  const required: Placeholder[] = REQUIRED_TEMPLATE_VARIABLES.map((v) => ({
    token: v.token,
    raw: v.raw,
    required: true,
  }));
  return mergePlaceholders([
    ...required,
    ...globalPlaceholders,
    ...allPlaceholders.filter((p) => additionalTyped.some((a) => a.token === p.token)),
    ...additionalTyped,
    ...dateVars,
  ]);
}

// The curated, template-independent set of variables a user can fill on the
// setup page. Used to (a) drive the section-template variable picker and (b)
// decide which body <placeholders> count as fillable setup variables.
export function setupVariableCatalog(): Placeholder[] {
  const required: Placeholder[] = REQUIRED_TEMPLATE_VARIABLES.map((v) => ({
    token: v.token,
    raw: v.raw,
    required: true,
  }));
  const additional = ADDITIONAL_TEMPLATE_VARIABLES.map((raw) => canonicalPlaceholder(raw))
    .filter((p): p is Placeholder => p != null)
    .map((p) => (SIMPLE_DATE_TOKENS.has(p.token) ? { ...p, kind: "date" as const } : p));
  const dateVars: Placeholder[] = DATE_TEMPLATE_VARIABLES.map((d) => ({
    token: d.token,
    raw: d.raw,
    kind: "date",
  }));
  return mergePlaceholders([...required, ...additional, ...dateVars]);
}

const KNOWN_SETUP_TOKENS = new Set(setupVariableCatalog().map((p) => p.token));

// Maps the derived day/month/year tokens of a "date" variable back to the
// single date token the user actually fills in on setup.
const DATE_ALIAS_TO_VAR: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const d of DATE_TEMPLATE_VARIABLES) {
    map[d.dayToken] = d.token;
    map[d.monthToken] = d.token;
    map[d.yearToken] = d.token;
  }
  return map;
})();

// Determines which setup variables a section depends on: every fillable
// <placeholder> in its body/title, plus any explicit per-section additions.
export function inferRequiredVariables(bodyText = "", title = ""): string[] {
  const tokens = new Set<string>();
  for (const m of `${bodyText} ${title}`.matchAll(/<([^<>\n]{2,200}?)>/g)) {
    const raw = m[1] ?? "";
    const tok = canonicalToken(raw);
    const mapped = DATE_ALIAS_TO_VAR[tok] ?? tok;
    if (KNOWN_SETUP_TOKENS.has(mapped)) tokens.add(mapped);
  }
  for (const role of ["managing-trustee", "secretary", "treasurer", "income-tax-representative", "medical-superintendent"]) {
    if (
      tokens.has(`${role}-subject-pronoun`) ||
      tokens.has(`${role}-object-pronoun`) ||
      tokens.has(`${role}-possessive-pronoun`)
    ) {
      tokens.add(`${role}-gender`);
    }
  }
  const key = normalizeSectionTitleForMap(title);
  for (const extra of SECTION_VARIABLE_MAP[key] ?? []) tokens.add(extra);
  return [...tokens];
}

function normalizeSectionTitleForMap(title: string): string {
  return title
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  // Expand each registered "date" variable into its day / month / year tokens
  // so the .docx renders correctly without exposing three separate inputs.
  for (const date of DATE_TEMPLATE_VARIABLES) {
    const raw = out[date.token];
    const parts = dateParts(raw);
    if (parts) {
      out[date.dayToken] = parts.day;
      out[date.monthToken] = parts.month;
      out[date.yearToken] = parts.year;
    }
  }
  for (const role of ["managing-trustee", "secretary", "treasurer", "income-tax-representative", "medical-superintendent"]) {
    const pronouns = pronounsForGender(out[`${role}-gender`]);
    if (!pronouns) continue;
    out[`${role}-subject-pronoun`] ||= pronouns.subject;
    out[`${role}-object-pronoun`] ||= pronouns.object;
    out[`${role}-possessive-pronoun`] ||= pronouns.possessive;
  }
  for (const tok of SIMPLE_DATE_TOKENS) {
    const formatted = formatDate(out[tok]);
    if (formatted) out[tok] = formatted;
  }
  return out;
}

export function fillTemplateText(text: string, variables: Record<string, string>): string {
  return text.replace(/<([^<>\n]{2,200}?)>/g, (full, raw: string) => {
    const value = variables[canonicalToken(raw)];
    return value != null && value !== "" ? value : full;
  });
}

function pronounsForGender(value?: string | null): { subject: string; object: string; possessive: string } | null {
  const v = (value ?? "").trim().toLowerCase();
  if (["female", "f", "woman", "lady", "she", "her"].includes(v)) {
    return { subject: "she", object: "her", possessive: "her" };
  }
  if (["male", "m", "man", "gentleman", "he", "him", "his"].includes(v)) {
    return { subject: "he", object: "him", possessive: "his" };
  }
  return null;
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
