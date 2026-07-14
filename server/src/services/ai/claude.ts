import { env } from "../../config/env.ts";
import type { Adapter, GenerateOpts, GenerateResult, StreamHandler } from "./types.ts";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export const claudeAdapter: Adapter = {
  id: "claude",
  isConfigured: () => Boolean(env.anthropic.apiKey),
  async listModels() {
    // No public list endpoint that works without account permissions —
    // surface a curated set keyed off the configured default.
    return ["claude-sonnet-5"];
  },
  async generate(opts: GenerateOpts, onChunk?: StreamHandler): Promise<GenerateResult> {
    if (!env.anthropic.apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const model = opts.model || env.anthropic.model;
    const body = {
      model,
      max_tokens: env.anthropic.maxOutputTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      stream: Boolean(opts.stream),
    };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`claude error ${res.status}: ${await res.text().catch(() => "")}`);
    }
    if (!opts.stream) {
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      return {
        text,
        provider: "claude",
        model,
        usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      };
    }
    // SSE stream
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
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
            const piece = j.delta.text ?? "";
            if (piece) {
              out += piece;
              onChunk?.(piece);
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return { text: out, provider: "claude", model };
  },
};
