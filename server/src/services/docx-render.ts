// Produces a finished .docx by editing a copy of the template:
//   1. Replace every <placeholder> token (header + section bodies) with the
//      variable value from variables_json.
//   2. For each section, swap the original boilerplate paragraphs with
//      paragraphs rendered from the approved section_draft markdown.
//
// Markdown subset supported: bullet lists ('- '), bold (**…**), italic (*…*).
// Anything else flows as plain paragraphs.

import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import type { ParsedTemplate } from "./template-parser.ts";

export type ApprovedSection = { key: string; ordinal: number; content_md: string };

export async function renderDocx(args: {
  templatePath: string;
  parsed: ParsedTemplate;
  variables: Record<string, string>;
  sections: ApprovedSection[];
}): Promise<Uint8Array> {
  const { templatePath, parsed, variables, sections } = args;
  const buf = await readFile(templatePath);
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("template missing word/document.xml");
  let xml = await docFile.async("string");

  // 1) Replace section bodies first (so they don't get re-tokenized).
  //    Look up each section's bodyXml as a substring; if found, replace it
  //    wholesale with newly rendered paragraphs.
  const byKey = new Map(sections.map((s) => [s.key, s]));
  for (const sec of parsed.sections) {
    const newSec = byKey.get(sec.key);
    if (!newSec) continue;
    if (!sec.bodyXml) continue;
    const rendered = markdownToWordXml(newSec.content_md);
    if (xml.includes(sec.bodyXml)) {
      xml = xml.replace(sec.bodyXml, rendered);
    }
  }

  // 2) Replace <placeholder> tokens in the resulting xml using variables.
  xml = replacePlaceholders(xml, variables);

  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replacePlaceholders(xml: string, vars: Record<string, string>): string {
  // Build a quick lookup keyed by both the raw token and a normalized form.
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    lookup.set(k.trim().toLowerCase(), v);
  }
  return xml.replace(/&lt;([^<>&\n]{2,200}?)&gt;/g, (full, raw: string) => {
    const key = raw.trim().toLowerCase();
    const v = lookup.get(key);
    return v != null && v !== "" ? xmlEscape(v) : full;
  });
}

function markdownToWordXml(md: string): string {
  const lines = md.split(/\r?\n/);
  const paras: string[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    for (const b of bullets) {
      paras.push(
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${runsFromInline(b)}</w:p>`,
      );
    }
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flushBullets();
      paras.push(`<w:p>${runsFromInline(line)}</w:p>`);
    }
  }
  flushBullets();
  return paras.join("");
}

function runsFromInline(text: string): string {
  // very small inline parser for **bold** and *italic*
  type Run = { text: string; bold: boolean; italic: boolean };
  const runs: Run[] = [];
  let i = 0;
  let bold = false;
  let italic = false;
  let buf = "";
  const push = () => {
    if (!buf) return;
    runs.push({ text: buf, bold, italic });
    buf = "";
  };
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      push();
      bold = !bold;
      i += 2;
      continue;
    }
    if (text[i] === "*") {
      push();
      italic = !italic;
      i += 1;
      continue;
    }
    buf += text[i]!;
    i += 1;
  }
  push();
  return runs
    .map((r) => {
      const rpr =
        r.bold || r.italic
          ? `<w:rPr>${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}</w:rPr>`
          : "";
      return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
    })
    .join("");
}
