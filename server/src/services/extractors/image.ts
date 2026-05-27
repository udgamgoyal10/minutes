import { readFile } from "node:fs/promises";
import { generate } from "../ai/index.ts";
import { env } from "../../config/env.ts";
import { OCR_PROMPT } from "./pdf.ts";

export async function extractImage(path: string, mime: string): Promise<string> {
  if (!env.gemini.apiKey) {
    throw new Error("Image OCR requested but GOOGLE_API_KEY is not configured");
  }
  const bytes = await readFile(path);
  const res = await generate({
    provider: "gemini",
    model: env.gemini.ocrModel,
    prompt: OCR_PROMPT,
    images: [{ mime: mime || "image/png", data: new Uint8Array(bytes) }],
  });
  return res.text.trim();
}
