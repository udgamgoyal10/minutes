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
  "Output must be Word-compatible plain prose. Use ONLY this minimal markdown subset: paragraphs separated by blank lines, bullet items starting with '- ', **bold** and *italic* inline emphasis, and GitHub-flavoured markdown tables only when the user/template explicitly requests a table or source tabular data must be preserved. " +
  "When using a markdown table, include a header row and separator row and keep source row/column meaning intact. Do NOT use markdown headings (#, ##), numbered lists (1.), blockquotes (>), code fences (```), inline code backticks, or horizontal rules. " +
  "Write resolutions as plain paragraphs in the form: RESOLVED THAT \u2026 (no italics, no quotes around the whole resolution).";

const STYLE_GUIDE =
  "Meeting-minutes style reference:\n" +
  "- Narrative paragraph example: The members discussed the proposal placed before the Board and, after due deliberation, approved the same unanimously.\n" +
  "- Resolution paragraph example: “RESOLVED THAT the Trust be and is hereby authorised to undertake the said activity in accordance with the objects of the Trust and applicable law.”\n" +
  "- Authority paragraph example: “RESOLVED FURTHER THAT <Trustee 1>, Managing Trustee, be and is hereby authorised to do all such acts, deeds and things as may be necessary to give effect to this resolution.”\n" +
  "- Match the template wording below where relevant; preserve formal phrases like 'with the permission of the Chair', 'placed before the Board', and 'resolved unanimously'.\n\n";

// Per-section guidance describing WHAT to put into the <placeholder> locations.
// This text is appended to whichever base prompt (template-fill or rewrite)
// buildPrompt selects, so it applies in both modes.
const NO_PII_EXPENSES =
  "Do NOT include vendor names, payment methods, monetary amounts, or dates anywhere in the output.";

const SECTION_GUIDANCE: Record<string, (ctx: PromptContext) => string> = {
  "review-of-significant-activities": () =>
    "Section-specific guidance:\n" +
    "- Summarise significant trust activities NOT already covered by earlier sections.\n" +
    "- Focus EXCLUSIVELY on expense entries greater than \u20b91,00,000 (one lakh); ignore everything at or below one lakh.\n" +
    "- If no expense exceeds one lakh, write a single short sentence stating that no significant (> \u20b91 L) expenses were recorded in the period.\n" +
    "- Cluster the > \u20b91 L items by activity and present as a clean bullet list followed by any resolutions the board passed.\n" +
    `- ${NO_PII_EXPENSES}\n`,
  "maintenance-of-agricultural-fields": (ctx) => expenseGuidance(ctx, "agricultural"),
  "maintenance-of-the-agricultural-fields": (ctx) => expenseGuidance(ctx, "agricultural"),
  "maintenance-of-livestock": (ctx) => expenseGuidance(ctx, "livestock"),
  "livestock-expenses": (ctx) => expenseGuidance(ctx, "livestock"),
  "maintenance-of-gardens": (ctx) => expenseGuidance(ctx, "garden"),
  "maintenance-of-gardens-amra-vatika-bhakti-kunj-and-all-the-other-gardens": (ctx) =>
    expenseGuidance(ctx, "garden"),
  "progress-report-on-construction-projects": () =>
    "Section-specific guidance:\n" +
    "- Summarise the construction activity and progress made during the period from the free-form source text, uploaded source text, or pasted source material.\n" +
    "- If the source is organised by month and project, preserve the month/project meaning but condense repeated expense wording into formal meeting-minutes prose.\n" +
    `- ${NO_PII_EXPENSES}\n`,
  "investment-chart": () =>
    "Section-specific guidance:\n" +
    "- For each placeholder of the form <insert fund names here where \u2026>, list only fund names that appear in the sources.\n" +
    "- There are EXACTLY five recognised fund types for this trust: Poor Relief Fund, Corpus Endowment, Corpus, Hospital, and General Fund.\n" +
    "- When mentioning which funds had new investments, received interest, or had premature redemptions, you MUST use ONLY these exact five names. Map any synonyms/abbreviations onto these five; if a fund does not match any of the five, omit it rather than inventing a name.\n" +
    "- In the narrative bullets, cover (only when the sources support it): which of the five funds made new investments and into which schemes; any premature redemption/withdrawal (which fund); interest received (which fund and scheme); and any investments that matured and what happened to the proceeds.\n" +
    "- Do NOT include dates, bank account names, bank names, or any rupee amounts.\n",
};

function expenseGuidance(_ctx: PromptContext, kind: "agricultural" | "livestock" | "garden"): string {
  const label =
    kind === "agricultural"
      ? "agricultural fields"
      : kind === "livestock"
        ? "livestock"
        : "gardens";
  return (
    "Section-specific guidance:\n" +
    `- Summarise expenses incurred for maintenance of ${label} during the period.\n` +
    "- If ANY expense in the sources is greater than \u20b91,00,000 (one lakh), focus ONLY on those > \u20b91 L items \u2014 describe what the money was spent on.\n" +
    "- If NO expense exceeds one lakh, summarise across all expenses, ordered by highest value first and by most common category, clustering small recurring entries.\n" +
    "- Present the result as a short clean bullet list.\n" +
    `- ${NO_PII_EXPENSES}\n`
  );
}

function sourcesBlock(ctx: PromptContext, includeSources: boolean): string {
  if (!includeSources) return "";
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

function guidanceBlock(ctx: PromptContext): string {
  const fn = SECTION_GUIDANCE[ctx.section.key];
  return fn ? `\n${fn(ctx)}\n` : "";
}

export function buildPrompt(ctx: PromptContext, options: { includeSources?: boolean } = {}): { system: string; prompt: string } {
  const templateBody = ctx.templateBodyText || ctx.section.bodyText;
  const includeSources = options.includeSources ?? true;
  const hasPlaceholders = /<[^<>\n]{2,200}>/.test(templateBody);
  const header =
    `Meeting: ${ctx.meetingTitle}\n` +
    `Meeting date: ${ctx.meetingDate || "(unset)"}; previous meeting: ${ctx.previousMeetingDate || "(unset)"}\n\n` +
    `Section title: ${ctx.section.title}\n\n`;

  // Default behaviour: only change the <placeholder> locations and keep every
  // other word of the template intact. This applies whenever the section is in
  // "template" mode and the body still contains <placeholders>. A user prompt
  // (appended later by the caller) can override this when they want more.
  if (ctx.mode !== "ai" && hasPlaceholders) {
    const fill =
      header +
      STYLE_GUIDE +
      dateWindowBlock(ctx) +
      "Template wording for this section (KEEP every word and line break exactly, only replace the <placeholder> tokens):\n" +
      `"""\n${templateBody}\n"""\n\n` +
      guidanceBlock(ctx) +
      sourcesBlock(ctx, includeSources) +
      placeholderBlock(ctx) +
      "\n\nReplace each <placeholder> with concise AI-summarized content drawn ONLY from the sources within the date window. " +
      "If a placeholder cannot be filled from the sources, leave the <placeholder> token intact. " +
      "Do NOT rewrite, reorder, paraphrase, or remove any other template wording. " +
      "Return the filled section body only.";
    return { system: SYSTEM_BASE, prompt: fill };
  }

  const generic =
    header +
    STYLE_GUIDE +
    dateWindowBlock(ctx) +
    "Template boilerplate for this section (use as reference; if blank, draft from scratch using the additional instruction and sources):\n" +
    `"""\n${templateBody || "(blank custom section)"}\n"""\n\n` +
    guidanceBlock(ctx) +
    sourcesBlock(ctx, includeSources) +
    placeholderBlock(ctx) +
    "\n\nReturn the rewritten section body only (no heading, no preamble).";
  return { system: SYSTEM_BASE, prompt: generic };
}
