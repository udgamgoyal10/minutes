import { env } from "../../config/env.ts";
import type { Adapter, GenerateOpts, GenerateResult, StreamHandler } from "./types.ts";

function bytesToBase64(bytes: Uint8Array): string {
  // Bun has a native btoa; bytes -> binary string -> base64
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export const geminiAdapter: Adapter = {
  id: "gemini",
  isConfigured: () => Boolean(env.gemini.apiKey),
  async listModels() {
    if (!env.gemini.apiKey) return [];
    return ["gemini-3.5"];
  },
  async generate(opts: GenerateOpts, onChunk?: StreamHandler): Promise<GenerateResult> {
    if (!env.gemini.apiKey) throw new Error("GOOGLE_API_KEY not set");
    const model = opts.model || env.gemini.chatModel;
    const parts: Array<Record<string, unknown>> = [];
    if (opts.images?.length) {
      for (const img of opts.images) {
        parts.push({ inline_data: { mime_type: img.mime, data: bytesToBase64(img.data) } });
      }
    }
    parts.push({ text: opts.prompt });

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2 },
    };
    if (opts.system) {
      body.systemInstruction = { role: "system", parts: [{ text: opts.system }] };
    }

    const action = opts.stream ? "streamGenerateContent" : "generateContent";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}?key=${env.gemini.apiKey}${opts.stream ? "&alt=sse" : ""}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`gemini error ${res.status}: ${await res.text().catch(() => "")}`);
    }

    if (!opts.stream) {
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      return {
        text,
        provider: "gemini",
        model,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount,
          outputTokens: data.usageMetadata?.candidatesTokenCount,
        },
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const ev of events) {
        const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        try {
          const j = JSON.parse(payload) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const piece = (j.candidates?.[0]?.content?.parts ?? [])
            .map((p) => p.text ?? "")
            .join("");
          if (piece) {
            out += piece;
            onChunk?.(piece);
          }
        } catch {
          /* ignore */
        }
      }
    }
    return { text: out, provider: "gemini", model };
  },
};
