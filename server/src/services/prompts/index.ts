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
  "Return well-formed markdown with paragraphs and bullet lists where the template uses them.";

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
    "Cluster common expenses, omit specific dates and monetary values, and present as a clean " +
    "bullet list followed by any resolutions the board passed. Use 'RESOLVED THAT …' formatting for resolutions.\n\n" +
    sourcesBlock(ctx) +
    placeholderBlock(ctx),
  "investment-chart": (ctx) =>
    `Section: ${ctx.section.title}\n\n` +
    "Fill the bullet structure exactly as in the template. For each placeholder of the form " +
    "<insert fund names here where …>, list only fund names that appear in the sources. " +
    "Do NOT include any rupee amounts.\n\n" +
    sourcesBlock(ctx) +
    placeholderBlock(ctx),
};

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
