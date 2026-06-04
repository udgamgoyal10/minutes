// Prompt templates per section. Lookup is by section_key (slug), falls back to
// a generic template. Override keys here when a section needs custom behavior
// (e.g. "investment-chart", "review-of-significant-activities").

import type { ParsedSection } from "../template-parser.ts";

export type PromptContext = {
  organizationName: string;
  meetingTitle: string;
  meetingDate: string;
  previousMeetingDate: string;
  variables: Record<string, string>;
  section: ParsedSection;
  templateBodyText?: string;
  mode?: "template" | "ai";
  sources: Array<{ label: string; kind: string; text: string }>;
};

export const SYSTEM_BASE =
  "You are an experienced board secretary drafting meeting minutes for an Indian charitable trust. " +
  "Write in the same formal register as the template's boilerplate. " +
  "Use Indian English, third person, past tense. Never invent numbers, dates, or names. " +
  "If a placeholder cannot be filled from the provided sources, leave the placeholder text (e.g. <Trustee 1>) intact " +
  "and continue. Do not include monetary amounts unless they are explicitly present in the sources. " +
  "If the section is blank or the user requests a new resolution, draft suitable meeting-minutes text from scratch using only the instruction, template style, variables, and sources available. " +
  "Output must be Word-compatible plain prose. Use ONLY this minimal markdown subset: paragraphs separated by blank lines, bullet items starting with '- ', **bold** and *italic* inline emphasis. " +
  "Do NOT use markdown headings (#, ##), numbered lists (1.), tables, blockquotes (>), code fences (```), inline code backticks, or horizontal rules. " +
  "Write resolutions as plain paragraphs in the form: RESOLVED THAT \u2026 (no italics, no quotes around the whole resolution).";

const STYLE_GUIDE =
  "Meeting-minutes style reference:\n" +
  "- Narrative paragraph example: The members discussed the proposal placed before the Board and, after due deliberation, approved the same unanimously.\n" +
  "- Resolution paragraph example: “RESOLVED THAT the Trust be and is hereby authorised to undertake the said activity in accordance with the objects of the Trust and applicable law.”\n" +
  "- Authority paragraph example: “RESOLVED FURTHER THAT <Trustee 1>, Managing Trustee, be and is hereby authorised to do all such acts, deeds and things as may be necessary to give effect to this resolution.”\n" +
  "- Match the template wording below where relevant; preserve formal phrases like 'with the permission of the Chair', 'placed before the Board', and 'resolved unanimously'.\n\n";

const CUSTOM: Record<string, (ctx: PromptContext) => string> = {
  // Examples; the generic prompt handles the rest automatically.
  "review-of-significant-activities": (ctx) =>
    `Section: ${ctx.section.title}\n\n` +
    "Summarize significant trust activities NOT already covered by earlier sections. " +
    "Focus EXCLUSIVELY on expense entries greater than \u20b91,00,000 (one lakh). " +
    "Ignore everything at or below \u20b91,00,000. If no expense in the sources exceeds one lakh, write a single short sentence stating that no significant (> \u20b91 L) expenses were recorded in the period. " +
    "Cluster the > \u20b91 L items by activity, omit specific rupee values in the narrative, and present as a clean bullet list followed by any resolutions the board passed. " +
    "Use 'RESOLVED THAT \u2026' formatting for resolutions.\n\n" +
    sourcesBlock(ctx) +
    placeholderBlock(ctx),
  "maintenance-of-agricultural-fields": (ctx) => expensePrompt(ctx, "agricultural"),
  "maintenance-of-the-agricultural-fields": (ctx) => expensePrompt(ctx, "agricultural"),
  "maintenance-of-livestock": (ctx) => expensePrompt(ctx, "livestock"),
  "livestock-expenses": (ctx) => expensePrompt(ctx, "livestock"),
  "maintenance-of-gardens": (ctx) => expensePrompt(ctx, "garden"),
  "maintenance-of-gardens-amra-vatika-bhakti-kunj-and-all-the-other-gardens": (ctx) =>
    expensePrompt(ctx, "garden"),
  "investment-chart": (ctx) =>
    `Section: ${ctx.section.title}\n\n` +
    "Fill the bullet structure exactly as in the template. For each placeholder of the form " +
    "<insert fund names here where …>, list only fund names that appear in the sources. " +
    "Do NOT include any rupee amounts.\n\n" +
    "There are EXACTLY five recognised fund types for this trust:\n" +
    "  1. Poor Relief Fund\n" +
    "  2. Corpus Endowment\n" +
    "  3. Corpus\n" +
    "  4. Hospital\n" +
    "  5. General Fund\n" +
    "When mentioning which funds had new investments, received interest, or had premature redemptions, you MUST use ONLY these exact names. " +
    "Map any synonyms / abbreviations in the sources onto these five names; if a source mentions a fund that does not match any of the five, omit it rather than inventing a new fund name.\n\n" +
    "When summarising the AI overview / narrative bullets for this section you MUST cover, in plain English and only when the sources support it:\n" +
    "  - which of the five funds were used to make new investments (i.e., source of funds) and into which schemes/instruments those investments were placed,\n" +
    "  - any premature redemption / pre-mature withdrawal of investments that occurred during the period (which of the five funds was affected),\n" +
    "  - interest received on existing investments (mention which of the five funds received interest and the schemes that paid interest; do NOT list rupee amounts),\n" +
    "  - any investments that matured during the period and what happened to the proceeds.\n" +
    "If the sources are silent on one of these aspects, omit the corresponding bullet rather than inventing data.\n\n" +
    sourcesBlock(ctx) +
    placeholderBlock(ctx),
};

function expensePrompt(ctx: PromptContext, kind: "agricultural" | "livestock" | "garden"): string {
  const label =
    kind === "agricultural"
      ? "agricultural fields"
      : kind === "livestock"
        ? "livestock"
        : "gardens";
  return (
    `Section: ${ctx.section.title}\n\n` +
    `Summarise expenses incurred for maintenance of ${label} during the period.\n\n` +
    "Focus rules (apply in this order):\n" +
    "  1. If ANY expense in the sources is greater than \u20b91,00,000 (one lakh), focus the narrative ONLY on those > \u20b91 L items \u2014 describe what the money was spent on, but do NOT print rupee amounts.\n" +
    "  2. If NO expense exceeds one lakh, fall back to summarising across all expenses, ordered by highest value first and by most common category. Cluster small recurring entries; do NOT print rupee amounts.\n\n" +
    "Present the result as a short clean bullet list. Add any resolution paragraphs the sources support afterwards using 'RESOLVED THAT \u2026' formatting.\n\n" +
    sourcesBlock(ctx) +
    placeholderBlock(ctx)
  );
}

function sourcesBlock(ctx: PromptContext): string {
  if (!ctx.sources.length) return "Sources: (none provided)\n\n";
  const parts = ctx.sources.map(
    (s, i) => `--- source ${i + 1} [${s.kind}] ${s.label || ""} ---\n${s.text}`,
  );
  return `Sources:\n${parts.join("\n\n")}\n\n`;
}

function placeholderBlock(ctx: PromptContext): string {
  if (!ctx.section.placeholders.length) return "Placeholders in this section: (none)";
  const lines = ctx.section.placeholders.map((p) => `- <${p.raw}>`).join("\n");
  return `Placeholders to fill (leave as-is if no data):\n${lines}`;
}

function dateWindowBlock(ctx: PromptContext): string {
  if (!ctx.meetingDate && !ctx.previousMeetingDate) return "";
  return (
    `Date window: only consider source data dated AFTER ${ctx.previousMeetingDate || "(start of history)"} ` +
    `and ON or BEFORE ${ctx.meetingDate || "(this meeting date)"}. ` +
    "Ignore rows, entries, or events outside that window.\n\n"
  );
}

export function buildPrompt(ctx: PromptContext): { system: string; prompt: string } {
  const templateBody = ctx.templateBodyText || ctx.section.bodyText;
  const isTemplateFill = ctx.mode === "template" && ctx.sources.length > 0 && /<[^<>\n]{2,200}>/.test(templateBody);
  const custom = CUSTOM[ctx.section.key];

  if (isTemplateFill) {
    const fill =
      `Organization: ${ctx.organizationName}\n` +
      `Meeting: ${ctx.meetingTitle}\n` +
      `Meeting date: ${ctx.meetingDate || "(unset)"}; previous meeting: ${ctx.previousMeetingDate || "(unset)"}\n\n` +
      `Section title: ${ctx.section.title}\n\n` +
      STYLE_GUIDE +
      dateWindowBlock(ctx) +
      "Template wording for this section (KEEP every word and line break exactly, only replace the <placeholder> tokens):\n" +
      `"""\n${templateBody}\n"""\n\n` +
      sourcesBlock(ctx) +
      placeholderBlock(ctx) +
      "\n\nReplace each <placeholder> with concise AI-summarized content drawn ONLY from the sources within the date window. " +
      "If a placeholder cannot be filled from the sources, leave the <placeholder> token intact. " +
      "Do NOT rewrite, reorder, paraphrase, or remove any other template wording. " +
      "Return the filled section body only.";
    return { system: SYSTEM_BASE, prompt: fill };
  }

  if (custom) return { system: SYSTEM_BASE, prompt: STYLE_GUIDE + dateWindowBlock(ctx) + custom(ctx) };

  const generic =
    `Organization: ${ctx.organizationName}\n` +
    `Meeting: ${ctx.meetingTitle}\n` +
    `Meeting date: ${ctx.meetingDate || "(unset)"}; previous meeting: ${ctx.previousMeetingDate || "(unset)"}\n\n` +
    `Section title: ${ctx.section.title}\n\n` +
    STYLE_GUIDE +
    dateWindowBlock(ctx) +
    "Template boilerplate for this section (use as reference; if blank, draft from scratch using the additional instruction and sources):\n" +
    `"""\n${templateBody || "(blank custom section)"}\n"""\n\n` +
    sourcesBlock(ctx) +
    placeholderBlock(ctx) +
    "\n\nReturn the rewritten section body only (no heading, no preamble).";
  return { system: SYSTEM_BASE, prompt: generic };
}
