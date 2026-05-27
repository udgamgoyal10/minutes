export type ProviderId = "ollama" | "claude" | "gemini" | "openai";

export type GenerateOpts = {
  provider: ProviderId;
  model?: string;
  system?: string;
  prompt: string;
  // For Gemini OCR: pass inline image bytes
  images?: Array<{ mime: string; data: Uint8Array }>;
  // If true the adapter should stream; otherwise resolve with the full string.
  stream?: boolean;
  signal?: AbortSignal;
};

export type GenerateResult = {
  text: string;
  provider: ProviderId;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type StreamHandler = (chunk: string) => void;

export interface Adapter {
  id: ProviderId;
  isConfigured(): boolean;
  listModels(): Promise<string[]>;
  generate(opts: GenerateOpts, onChunk?: StreamHandler): Promise<GenerateResult>;
}
