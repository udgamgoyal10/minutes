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
import { canonicalToken } from "./template-variables.ts";

export type ApprovedSection = {
  key: string;
  ordinal: number;
  title: string;
  content_md: string;
  template_body_text?: string;
};

export async function renderDocx(args: {
  templatePath: string;
  parsed: ParsedTemplate;
  variables: Record<string, string>;
  sections: ApprovedSection[];
}): Promise<Uint8Array> {
  const { templatePath, variables, sections } = args;
  return renderDocxBody({
    templatePath,
    variables,
    bodyXml: sectionsToWordXml(sections),
  });
}

export async function renderCombinedDocx(args: {
  templatePath: string;
  meetings: Array<{ heading: string; sections: ApprovedSection[] }>;
}): Promise<Uint8Array> {
  const bodyXml = args.meetings
    .map((meeting, index) => {
      const prefix = `${index === 0 ? "" : pageBreakXml()}${headingToWordXml(meeting.heading)}`;
      return `${prefix}${sectionsToWordXml(meeting.sections)}`;
    })
    .join("");
  return renderDocxBody({ templatePath: args.templatePath, variables: {}, bodyXml });
}

async function renderDocxBody(args: {
  templatePath: string;
  variables: Record<string, string>;
  bodyXml: string;
}): Promise<Uint8Array> {
  const buf = await readFile(args.templatePath);
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("template missing word/document.xml");
  let xml = await docFile.async("string");

  xml = rebuildBody(xml, args.bodyXml);

  xml = replacePlaceholders(xml, args.variables);

  xml = colorizeUnfilledPlaceholders(xml);

  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}

function rebuildBody(xml: string, rendered: string): string {
  const m = xml.match(/(<w:body\b[^>]*>)([\s\S]*?)(<\/w:body>)/);
  if (!m) return xml;
  const bodyOpen = m[1] ?? "<w:body>";
  const bodyInner = m[2] ?? "";
  const bodyClose = m[3] ?? "</w:body>";
  const sectPrMatch = bodyInner.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/);
  const sectPr = sectPrMatch?.[0] ?? "";
  return xml.replace(m[0], `${bodyOpen}${rendered}${sectPr}${bodyClose}`);
}

function sectionsToWordXml(sections: ApprovedSection[]): string {
  const sorted = [...sections].sort((a, b) => a.ordinal - b.ordinal);
  const hasIntro = sorted.some((section) => section.key === "introduction");
  return sorted
    .map((section) => {
      const title = section.key === "introduction" ? section.title : `${hasIntro ? section.ordinal - 1 : section.ordinal}. ${section.title}`;
      return `${headingToWordXml(title)}${markdownToWordXml(section.content_md)}`;
    })
    .join("");
}

function headingToWordXml(title: string): string {
  const baseFont = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="28"/><w:szCs w:val="28"/>';
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr>${baseFont}<w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r></w:p>`;
}

function pageBreakXml(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replacePlaceholders(xml: string, vars: Record<string, string>): string {
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    lookup.set(canonicalToken(k), v);
  }
  return xml.replace(/&lt;([^<>&\n]{2,200}?)&gt;/g, (full, raw: string) => {
    const key = canonicalToken(raw);
    const v = lookup.get(key);
    return v != null && v !== "" ? xmlEscape(v) : full;
  });
}

// Wrap any remaining <placeholder> tokens in a red-coloured run so unfilled
// values stand out in the exported Word document. Operates run-by-run; a run's
// text node cannot contain raw angle brackets (they are XML-escaped), so we
// match the escaped &lt;…&gt; form inside <w:t> nodes and split the run.
function colorizeUnfilledPlaceholders(xml: string): string {
  const RUN_RE = /<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)<\/w:r>/g;
  return xml.replace(RUN_RE, (full, rPr: string | undefined, tOpen: string, text: string, tClose: string) => {
    if (!/&lt;[^&]{1,200}?&gt;/.test(text)) return full;
    const rpr = rPr ?? "";
    const redRpr = rpr
      ? rpr.replace("</w:rPr>", '<w:color w:val="FF0000"/></w:rPr>')
      : '<w:rPr><w:color w:val="FF0000"/></w:rPr>';
    // Split the text into placeholder vs. plain segments, preserving order.
    const segments = text.split(/(&lt;[^&]{1,200}?&gt;)/).filter((s) => s.length > 0);
    return segments
      .map((seg) => {
        const isPlaceholder = /^&lt;[^&]{1,200}?&gt;$/.test(seg);
        const pr = isPlaceholder ? redRpr : rpr;
        return `<w:r>${pr}${tOpen}${seg}${tClose}</w:r>`;
      })
      .join("");
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
  const baseFont = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/>';
  return runs
    .map((r) => {
      const rpr = `<w:rPr>${baseFont}${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}</w:rPr>`;
      return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
    })
    .join("");
}
