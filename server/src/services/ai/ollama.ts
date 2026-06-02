import { env } from "../../config/env.ts";
import type { Adapter, GenerateOpts, GenerateResult, StreamHandler } from "./types.ts";

async function listOllamaModels(): Promise<string[]> {
  try {
    const r = await fetch(`${env.ollama.baseUrl}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveModel(requested?: string): Promise<string> {
  const models = await listOllamaModels();
  if (requested && models.includes(requested)) return requested;
  if (!requested && env.ollama.defaultModel && models.includes(env.ollama.defaultModel)) return env.ollama.defaultModel;
  const model = models[0] ?? requested ?? env.ollama.defaultModel;
  if (!model) throw new Error("ollama has no available models");
  return model;
}

export const ollamaAdapter: Adapter = {
  id: "ollama",
  isConfigured: () => Boolean(env.ollama.baseUrl),
  async listModels() {
    return listOllamaModels();
  },
  async generate(opts: GenerateOpts, onChunk?: StreamHandler): Promise<GenerateResult> {
    const model = await resolveModel(opts.model);
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: opts.prompt });

    const res = await fetch(`${env.ollama.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: Boolean(opts.stream) }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`ollama error ${res.status}: ${await res.text().catch(() => "")}`);
    }
    if (!opts.stream) {
      const data = (await res.json()) as { message?: { content?: string } };
      const text = data.message?.content ?? "";
      return { text, provider: "ollama", model };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const piece = j.message?.content ?? "";
          if (piece) {
            out += piece;
            onChunk?.(piece);
          }
        } catch {
          /* ignore parse errors on partial chunks */
        }
      }
    }
    return { text: out, provider: "ollama", model };
  },
};
