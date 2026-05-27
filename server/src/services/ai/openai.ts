import { env } from "../../config/env.ts";
import type { Adapter, GenerateOpts, GenerateResult, StreamHandler } from "./types.ts";

// Stub: OpenAI adapter activates when OPENAI_API_KEY is set. v1 keeps it simple
// (non-streaming chat completions). Wire streaming when it becomes the primary
// enterprise provider.
export const openaiAdapter: Adapter = {
  id: "openai",
  isConfigured: () => Boolean(env.openai.apiKey),
  async listModels() {
    if (!env.openai.apiKey) return [];
    return [env.openai.model, "gpt-4o", "gpt-4o-mini"].filter((v, i, a) => a.indexOf(v) === i);
  },
  async generate(opts: GenerateOpts, _onChunk?: StreamHandler): Promise<GenerateResult> {
    if (!env.openai.apiKey) throw new Error("OPENAI_API_KEY not set");
    const model = opts.model || env.openai.model;
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: opts.prompt });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.openai.apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`openai error ${res.status}: ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: "openai",
      model,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    };
  },
};
