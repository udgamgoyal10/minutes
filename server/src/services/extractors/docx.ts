import JSZip from "jszip";
import { readFile } from "node:fs/promises";

const RE_PARA = /<w:p\b[\s\S]*?<\/w:p>/g;
const RE_TEXT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RE_TAB = /<w:tab\b[^/]*\/>/g;
const RE_BR = /<w:br\b[^/]*\/>/g;

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export async function extractDocx(path: string): Promise<string> {
  const buf = await readFile(path);
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");

  const paras: string[] = [];
  let pm: RegExpExecArray | null;
  RE_PARA.lastIndex = 0;
  while ((pm = RE_PARA.exec(xml))) {
    const cleaned = pm[0].replace(RE_TAB, "\t").replace(RE_BR, "\n");
    const parts: string[] = [];
    RE_TEXT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_TEXT.exec(cleaned))) parts.push(decode(m[1] ?? ""));
    paras.push(parts.join(""));
  }
  return paras.join("\n").trim();
}
