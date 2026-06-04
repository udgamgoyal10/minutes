// Parses a .docx template into:
//   - ordered sections (by heading paragraphs)
//   - top-of-document variables (extracted from <…> tokens before the first section)
//   - per-section placeholder list
//
// .docx is a zip. word/document.xml has the body content. We treat any paragraph
// whose pStyle is Heading{N} (for N >= 1) as a section boundary.

import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { canonicalPlaceholder, mergePlaceholders, setupPlaceholders, slugifyVariable } from "./template-variables.ts";

export type Placeholder = { token: string; raw: string; kind?: "text" | "date" };

export type ParsedSection = {
  key: string;
  ordinal: number;
  title: string;
  bodyText: string;
  bodyXml: string;
  placeholders: Placeholder[];
};

export type ParsedTemplate = {
  title: string;
  preambleText: string;
  preambleXml: string;
  globalPlaceholders: Placeholder[];
  sections: ParsedSection[];
};

const RE_PARA = /<w:p\b[\s\S]*?<\/w:p>/g;
const RE_PSTYLE = /<w:pStyle\s+w:val="([^"]+)"/;
const RE_TEXT_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RE_TAB = /<w:tab\b[^/]*\/>/g;
const RE_BR = /<w:br\b[^/]*\/>/g;
const RE_ANGLE_TOKEN = /<([^<>\n]{2,200}?)>/g; // matches <…> tokens used as placeholders in the template
const RE_NUM_PR = /<w:numPr\b/;
const RE_BOLD = /<w:b(?:\s[^>]*)?\/>/;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function paragraphText(paragraphXml: string): string {
  const parts: string[] = [];
  // tabs first
  const cleaned = paragraphXml.replace(RE_TAB, "\t").replace(RE_BR, "\n");
  let m: RegExpExecArray | null;
  RE_TEXT_RUN.lastIndex = 0;
  while ((m = RE_TEXT_RUN.exec(cleaned))) {
    parts.push(decodeXmlEntities(m[1] ?? ""));
  }
  return parts.join("");
}

function headingLevel(paragraphXml: string): number | null {
  const m = paragraphXml.match(RE_PSTYLE);
  if (!m) return null;
  const style = m[1] ?? "";
  const hm = style.match(/^Heading(\d+)/);
  return hm ? Number(hm[1]) : null;
}

function isNumbered(paragraphXml: string): boolean {
  return RE_NUM_PR.test(paragraphXml);
}

function isBold(paragraphXml: string): boolean {
  return RE_BOLD.test(paragraphXml);
}

function templateHeadingTitle(paragraphXml: string): string | null {
  const title = paragraphText(paragraphXml).trim();
  if (!title) return null;
  const lvl = headingLevel(paragraphXml);
  if (lvl !== null && lvl >= 1) return title;
  if (title.startsWith("<")) return null;
  if (isNumbered(paragraphXml) && isBold(paragraphXml) && title.length <= 140) return title;
  if (/^(approval of proceedings|vote of thanks)$/i.test(title) && isBold(paragraphXml)) return title;
  return null;
}

function extractPlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  let m: RegExpExecArray | null;
  RE_ANGLE_TOKEN.lastIndex = 0;
  while ((m = RE_ANGLE_TOKEN.exec(text))) {
    const raw = m[1] ?? "";
    const placeholder = canonicalPlaceholder(raw);
    if (placeholder) out.push(placeholder);
  }
  return mergePlaceholders(out);
}

function slugify(s: string): string {
  return slugifyVariable(s);
}

// Boilerplate lines we strip from the "Review of Significant Activities"
// section template — these are placeholder instructions rather than wording
// that should appear in the final minutes.
const ROSA_BOILERPLATE_PATTERNS: RegExp[] = [
  /^<\s*insert\s+resolution\s*>$/i,
  /^<\s*description\s+of\s+activity\s+conducted\s+by\s+members\s+to\s+reach\s+resolution\s*>$/i,
  /^["“]?\s*resolved\s+that\s*<\s*insert\s+resolution\s*>\s*["”]?$/i,
  /^[\u2026.…]+\s*<\s*insert\s+additional\s+resolutions\s+as\s+separate\s+points\s+where\s+relevant\s*>$/i,
];

function isRosaBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return ROSA_BOILERPLATE_PATTERNS.some((re) => re.test(trimmed));
}

function removeIntroMeetingDateLines(lines: string[]): string[] {
  const out = [...lines];
  const start = out.findIndex((line) => /^meeting\s+dates\s*:?\s*$/i.test(line.trim()));
  if (start < 0) return out;
  let end = start + 1;
  while (end < out.length) {
    const line = out[end]!.trim();
    if (!line) {
      end += 1;
      continue;
    }
    if (/^minutes\s+of\s+the\s+meeting\b/i.test(line)) break;
    end += 1;
  }
  out.splice(start, end - start);
  return out;
}

export async function parseTemplate(docxPath: string): Promise<ParsedTemplate> {
  const buf = await readFile(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("word/document.xml missing in template");
  const xml = await documentFile.async("string");

  // Capture body content only
  const bodyMatch = xml.match(/<w:body\b[\s\S]*?<\/w:body>/);
  const body = bodyMatch ? bodyMatch[0] : xml;

  const paragraphs: string[] = [];
  let pm: RegExpExecArray | null;
  RE_PARA.lastIndex = 0;
  while ((pm = RE_PARA.exec(body))) {
    paragraphs.push(pm[0]);
  }

  type SectionAcc = {
    title: string;
    paraIndexStart: number;
    paraIndexEnd: number; // exclusive
  };
  const acc: SectionAcc[] = [];
  let preambleEnd = paragraphs.length; // until set

  paragraphs.forEach((p, i) => {
    const title = templateHeadingTitle(p);
    if (!title) return;
    if (acc.length === 0) preambleEnd = i;
    acc.push({ title, paraIndexStart: i, paraIndexEnd: paragraphs.length });
    if (acc.length > 1) acc[acc.length - 2]!.paraIndexEnd = i;
  });

  const preambleXml = paragraphs.slice(0, preambleEnd).join("");
  const preambleText = paragraphs.slice(0, preambleEnd).map(paragraphText).join("\n").trim();

  const introEnd = acc.findIndex((s) => /^approval of proceedings$/i.test(s.title));
  const regularAcc = introEnd >= 0 ? acc.slice(introEnd + 1) : acc;
  const sections: ParsedSection[] = [];

  if (introEnd >= 0) {
    const introParas = paragraphs.slice(0, acc[introEnd]!.paraIndexEnd);
    const bodyXml = introParas.join("");
    const bodyText = removeIntroMeetingDateLines(introParas.map(paragraphText)).join("\n").trim();
    sections.push({
      key: "introduction",
      ordinal: 1,
      title: "Introduction",
      bodyText,
      bodyXml,
      placeholders: extractPlaceholders(bodyText),
    });
  }

  regularAcc.forEach((s, idx) => {
    const rawBodyParas = paragraphs.slice(s.paraIndexStart + 1, s.paraIndexEnd);
    const sectionKey = slugify(s.title) || `section-${idx + 1}`;
    const bodyParas =
      sectionKey === "review-of-significant-activities"
        ? rawBodyParas.filter((p) => !isRosaBoilerplate(paragraphText(p)))
        : rawBodyParas;
    const bodyXml = bodyParas.join("");
    const bodyText = bodyParas.map(paragraphText).join("\n").trim();
    sections.push({
      key: sectionKey,
      ordinal: sections.length + 1,
      title: s.title,
      bodyText,
      bodyXml,
      placeholders: extractPlaceholders(`${s.title}\n${bodyText}`),
    });
  });

  // Dedupe section keys
  const seen = new Map<string, number>();
  for (const s of sections) {
    const n = seen.get(s.key) ?? 0;
    if (n > 0) s.key = `${s.key}-${n + 1}`;
    seen.set(s.key, n + 1);
  }

  const title = "Minutes of the Meeting";

  return {
    title,
    preambleText,
    preambleXml,
    globalPlaceholders: setupPlaceholders(
      extractPlaceholders(preambleText),
      sections.flatMap((s) => s.placeholders),
    ),
    sections,
  };
}
