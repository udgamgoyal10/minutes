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
  sources: Array<{ label: string; kind: string; text: string }>;
};

export const SYSTEM_BASE =
  "You are an experienced board secretary drafting meeting minutes for an Indian charitable trust. " +
  "Write in the same formal register as the template's boilerplate. " +
  "Use Indian English, third person, past tense. Never invent numbers, dates, or names. " +
  "If a placeholder cannot be filled from the provided sources, leave the placeholder text (e.g. <Trustee 1>) intact " +
  "and continue. Do not include monetary amounts unless they are explicitly present in the sources. " +
  "Return well-formed markdown with paragraphs and bullet lists where the template uses them.";

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

export function buildPrompt(ctx: PromptContext): { system: string; prompt: string } {
  const custom = CUSTOM[ctx.section.key];
  if (custom) return { system: SYSTEM_BASE, prompt: custom(ctx) };

  const generic =
    `Organization: ${ctx.organizationName}\n` +
    `Meeting: ${ctx.meetingTitle}\n` +
    `Meeting date: ${ctx.meetingDate || "(unset)"}; previous meeting: ${ctx.previousMeetingDate || "(unset)"}\n\n` +
    `Section title: ${ctx.section.title}\n\n` +
    "Template boilerplate (rewrite/extend, do not invent facts):\n" +
    `"""\n${ctx.section.bodyText}\n"""\n\n` +
    sourcesBlock(ctx) +
    placeholderBlock(ctx) +
    "\n\nReturn the rewritten section body only (no heading, no preamble).";
  return { system: SYSTEM_BASE, prompt: generic };
}
