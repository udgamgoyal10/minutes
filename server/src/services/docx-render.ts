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

// 12pt Calibri for the whole document (sz is in half-points).
const FONT = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="24"/><w:szCs w:val="24"/>';
// Line spacing in 240ths (auto): 1.25 = 300, 1.5 = 360.
const LINE_125 = "300";
const LINE_15 = "360";

// Introduction sub-headers (compared case-insensitively, trailing colon ignored).
// These render bold + underlined like section headers.
const INTRO_SUBHEADERS = new Set([
  "trustees present",
  "office bearers present",
  "special invitees",
  "members present",
  "in attendance",
  "also present",
  "chairperson",
  "quorum",
  "leave of absence",
  "notice of the meeting",
  "approval of proceedings",
]);
// Sub-header blocks within the introduction that use 1.5 line spacing.
const INTRO_ONE_AND_HALF_BLOCKS = new Set(["trustees present", "office bearers present"]);

function sectionsToWordXml(sections: ApprovedSection[]): string {
  const sorted = [...sections].sort((a, b) => a.ordinal - b.ordinal);
  let counter = 0;
  return sorted
    .map((section) => {
      if (section.key === "introduction") {
        // No "Introduction" heading; the body carries its own sub-headers.
        return introToWordXml(section.content_md);
      }
      const unnumbered = section.key === "vote-of-thanks" || /\bvote of thanks\b/i.test(section.title);
      const heading = unnumbered ? section.title : `${(counter += 1)}. ${section.title}`;
      return `${headingToWordXml(heading)}${markdownToWordXml(section.content_md)}`;
    })
    .join("");
}

// Section headers: bold + underlined, 12pt, no space beneath, number offset 0.5".
function headingToWordXml(title: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="0" w:after="0" w:line="${LINE_125}" w:lineRule="auto"/><w:ind w:left="720"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr>${FONT}<w:b/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r></w:p>`;
}

function normalizeHeaderText(s: string): string {
  return s.trim().replace(/[:：]\s*$/, "").toLowerCase();
}

function isFullyBold(line: string): boolean {
  return /^\*\*[\s\S]+\*\*$/.test(line) && !line.slice(2, -2).includes("**");
}

function stripSurroundingBold(line: string): string {
  return isFullyBold(line) ? line.slice(2, -2) : line;
}

function bodyParaXml(text: string, line: string, opts: { bold?: boolean; jc?: string } = {}): string {
  const jc = opts.jc ?? "both";
  return `<w:p><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>${runsFromInline(text, opts.bold)}</w:p>`;
}

function bulletParaXml(text: string, line: string): string {
  // Bullets sit at the left margin (single small indent) and read left-aligned.
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="360" w:hanging="360"/><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>${runsFromInline(text)}</w:p>`;
}

function splitMarkdownTableRow(line: string): string[] {
  let text = line.trim();
  if (!text.includes("|")) return [];
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells.length >= 2 ? cells : [];
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function tableCellParasXml(text: string, bold: boolean): string {
  const parts = text.split(/<br\s*\/?\s*>/i).map((part) => part.trim()).filter(Boolean);
  const safeParts = parts.length ? parts : [""];
  return safeParts.map((part) => `<w:p><w:pPr><w:spacing w:after="0" w:line="${LINE_125}" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>${runsFromInline(part, bold)}</w:p>`).join("");
}

function tableToWordXml(rows: string[][]): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
  const borders = '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
  const rowXml = normalized.map((row, rowIndex) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${tableCellParasXml(cell, rowIndex === 0)}</w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${rowXml}</w:tbl>`;
}

function subHeaderParaXml(text: string, line: string): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr>${FONT}<w:b/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

// Renders the introduction with its special formatting: bold opening paragraph,
// bold + underlined sub-headers, and 1.5 line spacing for the Trustees Present /
// Office Bearers Present blocks (1.25 elsewhere).
function introToWordXml(md: string): string {
  const lines = md.split(/\r?\n/);
  const paras: string[] = [];
  let bullets: string[] = [];
  let firstParagraphDone = false;
  let inOneAndHalfBlock = false;

  const currentLine = () => (inOneAndHalfBlock ? LINE_15 : LINE_125);
  const flushBullets = () => {
    for (const b of bullets) paras.push(bulletParaXml(b, currentLine()));
    bullets = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      flushBullets();
      continue;
    }
    const tableHeader = splitMarkdownTableRow(line);
    if (tableHeader.length && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1] ?? "")) {
      flushBullets();
      const rows = [tableHeader];
      i += 2;
      while (i < lines.length) {
        const row = splitMarkdownTableRow(lines[i] ?? "");
        if (!row.length) break;
        rows.push(row);
        i += 1;
      }
      i -= 1;
      paras.push(tableToWordXml(rows));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }
    flushBullets();
    const norm = normalizeHeaderText(line);
    if (INTRO_SUBHEADERS.has(norm) || isFullyBold(line)) {
      inOneAndHalfBlock = INTRO_ONE_AND_HALF_BLOCKS.has(norm);
      paras.push(subHeaderParaXml(stripSurroundingBold(line), currentLine()));
      continue;
    }
    if (!firstParagraphDone) {
      // Opening "Minutes of the (Annual) Meeting …" paragraph is bold.
      firstParagraphDone = true;
      paras.push(bodyParaXml(line, LINE_125, { bold: true }));
      continue;
    }
    paras.push(bodyParaXml(line, currentLine()));
  }
  flushBullets();
  return paras.join("");
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
    for (const b of bullets) paras.push(bulletParaXml(b, LINE_125));
    bullets = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      flushBullets();
      continue;
    }
    const tableHeader = splitMarkdownTableRow(line);
    if (tableHeader.length && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1] ?? "")) {
      flushBullets();
      const rows = [tableHeader];
      i += 2;
      while (i < lines.length) {
        const row = splitMarkdownTableRow(lines[i] ?? "");
        if (!row.length) break;
        rows.push(row);
        i += 1;
      }
      i -= 1;
      paras.push(tableToWordXml(rows));
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flushBullets();
      paras.push(bodyParaXml(line, LINE_125));
    }
  }
  flushBullets();
  return paras.join("");
}

const RESOLVED_FURTHER_RE = /resolved further that/gi;

function runsFromInline(text: string, forceBold = false): string {
  // very small inline parser for **bold** and *italic*
  type Run = { text: string; bold: boolean; italic: boolean };
  const runs: Run[] = [];
  let i = 0;
  let bold = false;
  let italic = false;
  let buf = "";
  const push = () => {
    if (!buf) return;
    runs.push({ text: buf, bold: bold || forceBold, italic });
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

  // "resolved further that" is always bold, wherever it appears.
  const expanded: Run[] = [];
  for (const run of runs) {
    RESOLVED_FURTHER_RE.lastIndex = 0;
    if (run.bold || !RESOLVED_FURTHER_RE.test(run.text)) {
      expanded.push(run);
      continue;
    }
    RESOLVED_FURTHER_RE.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = RESOLVED_FURTHER_RE.exec(run.text))) {
      if (m.index > last) expanded.push({ ...run, text: run.text.slice(last, m.index) });
      expanded.push({ ...run, text: m[0], bold: true });
      last = m.index + m[0].length;
    }
    if (last < run.text.length) expanded.push({ ...run, text: run.text.slice(last) });
  }

  return expanded
    .map((r) => {
      const rpr = `<w:rPr>${FONT}${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}</w:rPr>`;
      return `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
    })
    .join("");
}
