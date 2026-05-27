// Parses a .docx template into:
//   - ordered sections (by heading paragraphs)
//   - top-of-document variables (extracted from <…> tokens before the first section)
//   - per-section placeholder list
//
// .docx is a zip. word/document.xml has the body content. We treat any paragraph
// whose pStyle is Heading{N} (for N >= 1) as a section boundary.

import JSZip from "jszip";
import { readFile } from "node:fs/promises";

export type Placeholder = { token: string; raw: string };

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

function extractPlaceholders(text: string): Placeholder[] {
  const out = new Map<string, Placeholder>();
  let m: RegExpExecArray | null;
  RE_ANGLE_TOKEN.lastIndex = 0;
  while ((m = RE_ANGLE_TOKEN.exec(text))) {
    const raw = m[1] ?? "";
    const trimmed = raw.trim();
    // Skip obviously non-placeholder fragments (XML-y stuff, single chars)
    if (!trimmed || trimmed.length < 2) continue;
    if (/^[/!?]/.test(trimmed)) continue; // </…> or <!--
    if (/^[A-Z][A-Za-z0-9]*\s*[/=]/.test(trimmed)) continue;
    const token = slugify(trimmed);
    if (!out.has(token)) out.set(token, { token, raw: trimmed });
  }
  return [...out.values()];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
    headingLevel: number;
    paraIndexStart: number;
    paraIndexEnd: number; // exclusive
  };
  const acc: SectionAcc[] = [];
  let preambleEnd = paragraphs.length; // until set

  paragraphs.forEach((p, i) => {
    const lvl = headingLevel(p);
    if (lvl !== null && lvl >= 1) {
      const title = paragraphText(p).trim();
      if (!title) return;
      if (acc.length === 0) preambleEnd = i;
      acc.push({ title, headingLevel: lvl, paraIndexStart: i, paraIndexEnd: paragraphs.length });
      if (acc.length > 1) acc[acc.length - 2]!.paraIndexEnd = i;
    }
  });

  const preambleXml = paragraphs.slice(0, preambleEnd).join("");
  const preambleText = paragraphs.slice(0, preambleEnd).map(paragraphText).join("\n").trim();

  const sections: ParsedSection[] = acc.map((s, idx) => {
    // body excludes the heading paragraph itself
    const bodyParas = paragraphs.slice(s.paraIndexStart + 1, s.paraIndexEnd);
    const bodyXml = bodyParas.join("");
    const bodyText = bodyParas.map(paragraphText).join("\n").trim();
    return {
      key: slugify(s.title) || `section-${idx + 1}`,
      ordinal: idx + 1,
      title: s.title,
      bodyText,
      bodyXml,
      placeholders: extractPlaceholders(`${s.title}\n${bodyText}`),
    };
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
    globalPlaceholders: extractPlaceholders(preambleText),
    sections,
  };
}
