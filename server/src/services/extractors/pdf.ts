import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../ai/index.ts";
import { env } from "../../config/env.ts";

// PDF extraction strategy:
// 1) Try the text layer. If the result has reasonable letter density, return it.
// 2) Otherwise rasterize pages via `pdftoppm` (poppler-utils) and OCR each page
//    with Gemini 2.5 Flash vision.

const MIN_TEXT_LEN = 40;

export async function extractPdf(path: string): Promise<string> {
  const layoutText = await extractPdfTextLayout(path).catch(() => "");
  if (layoutText.length >= MIN_TEXT_LEN) return layoutText;
  const layerText = await extractPdfTextLayer(path).catch(() => "");
  if (layerText.length >= MIN_TEXT_LEN) return layerText;
  return await extractPdfViaOcr(path);
}

async function extractPdfTextLayout(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const proc = spawn("pdftotext", ["-layout", "-nopgbrk", path, "-"]);
    const chunks: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => errors.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `pdftotext exit ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8").replace(/[ \t]+$/gm, "").trim());
    });
  });
}

async function extractPdfTextLayer(path: string): Promise<string> {
  const buf = await readFile(path);
  const txt = buf.toString("latin1");
  const out: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) {
    if (!m[1]) continue;
    const decoded = m[1]
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
    out.push(decoded);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

async function extractPdfViaOcr(path: string): Promise<string> {
  if (!env.gemini.apiKey) {
    throw new Error("Scanned PDF detected but GOOGLE_API_KEY is not configured for OCR");
  }
  const workDir = join(tmpdir(), `minutes-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workDir, { recursive: true });
  try {
    await runPdftoppm(path, workDir);
    const pages = (await readdir(workDir))
      .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
      .sort();
    const out: string[] = [];
    for (const page of pages) {
      const bytes = await readFile(join(workDir, page));
      const mime = page.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const res = await generate({
        provider: "gemini",
        model: env.gemini.ocrModel,
        prompt: OCR_PROMPT,
        images: [{ mime, data: new Uint8Array(bytes) }],
      });
      out.push(res.text.trim());
    }
    return out.join("\n\n").trim();
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runPdftoppm(input: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pdftoppm", ["-r", "200", "-png", input, join(outDir, "page")]);
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pdftoppm exit ${code}`))));
  });
}

export const OCR_PROMPT =
  "Extract all readable text from this page verbatim. Preserve line breaks and paragraph structure. " +
  "If a region contains tabular data, render it as a GitHub-flavoured markdown table with a header row and separator row. Do not summarize, translate, " +
  "or add commentary. Output text only.";
