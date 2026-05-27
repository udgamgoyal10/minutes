import { ollamaAdapter } from "./ollama.ts";
import { claudeAdapter } from "./claude.ts";
import { geminiAdapter } from "./gemini.ts";
import { openaiAdapter } from "./openai.ts";
import type { Adapter, GenerateOpts, GenerateResult, ProviderId, StreamHandler } from "./types.ts";

const adapters: Record<ProviderId, Adapter> = {
  ollama: ollamaAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
  openai: openaiAdapter,
};

export function getAdapter(provider: ProviderId): Adapter {
  const a = adapters[provider];
  if (!a) throw new Error(`unknown provider: ${provider}`);
  return a;
}

export async function generate(
  opts: GenerateOpts,
  onChunk?: StreamHandler,
): Promise<GenerateResult> {
  const adapter = getAdapter(opts.provider);
  if (!adapter.isConfigured()) throw new Error(`provider not configured: ${opts.provider}`);
  return adapter.generate(opts, onChunk);
}

export async function listAllProviders(): Promise<Array<{
  id: ProviderId;
  configured: boolean;
  models: string[];
  category: "local" | "enterprise";
}>> {
  const out: Array<{
    id: ProviderId;
    configured: boolean;
    models: string[];
    category: "local" | "enterprise";
  }> = [];
  for (const id of ["ollama", "claude", "gemini", "openai"] as ProviderId[]) {
    const a = adapters[id];
    const configured = a.isConfigured();
    const models = configured ? await a.listModels().catch(() => []) : [];
    out.push({ id, configured, models, category: id === "ollama" ? "local" : "enterprise" });
  }
  return out;
}

export type { ProviderId } from "./types.ts";
