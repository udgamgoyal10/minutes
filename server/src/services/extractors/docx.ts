import JSZip from "jszip";
import { readFile } from "node:fs/promises";

const RE_BLOCK = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
const RE_PARA = /<w:p\b[\s\S]*?<\/w:p>/g;
const RE_ROW = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const RE_CELL = /<w:tc\b[\s\S]*?<\/w:tc>/g;
const RE_TEXT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RE_TAB = /<w:tab\b[^/]*\/>/g;
const RE_BR = /<w:br\b[^/]*\/>/g;

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function textFromParagraph(xml: string): string {
  const cleaned = xml.replace(RE_TAB, "\t").replace(RE_BR, "\n");
  const parts: string[] = [];
  RE_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_TEXT.exec(cleaned))) parts.push(decode(m[1] ?? ""));
  return parts.join("");
}

function textFromCell(xml: string): string {
  const paras: string[] = [];
  RE_PARA.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = RE_PARA.exec(xml))) {
    const text = textFromParagraph(pm[0]).trim();
    if (text) paras.push(text);
  }
  return paras.join("<br>");
}

function markdownCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function tableToMarkdown(xml: string): string {
  const rows: string[][] = [];
  RE_ROW.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = RE_ROW.exec(xml))) {
    const cells: string[] = [];
    RE_CELL.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = RE_CELL.exec(rm[0]))) cells.push(markdownCell(textFromCell(cm[0])));
    if (cells.some((cell) => cell.length > 0)) rows.push(cells);
  }
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
  const render = (row: string[]) => `| ${row.join(" | ")} |`;
  return [render(normalized[0]!), render(Array.from({ length: width }, () => "---")), ...normalized.slice(1).map(render)].join("\n");
}

export async function extractDocx(path: string): Promise<string> {
  const buf = await readFile(path);
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");

  const blocks: string[] = [];
  RE_BLOCK.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = RE_BLOCK.exec(xml))) {
    const block = bm[0];
    if (block.startsWith("<w:tbl")) {
      const table = tableToMarkdown(block);
      if (table) blocks.push(table);
    } else {
      const text = textFromParagraph(block);
      if (text.trim()) blocks.push(text);
    }
  }
  return blocks.join("\n\n").trim();
}
