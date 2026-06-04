// Single source of truth for environment configuration.
// All env reads in the server go through this module.

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: opt("NODE_ENV", "development"),
  port: num("PORT", 8787),
  publicUrl: opt("PUBLIC_URL", "http://localhost:5173"),

  jwtSecret: req("JWT_SECRET", "dev-only-insecure-secret"),
  accessTtl: num("ACCESS_TOKEN_TTL_SECONDS", 3600),
  refreshTtl: num("REFRESH_TOKEN_TTL_SECONDS", 60 * 60 * 24 * 7),
  adminEmail: opt("ADMIN_EMAIL", "admin@example.com"),
  adminPassword: opt("ADMIN_PASSWORD", "changeme"),

  sqlitePath: opt("SQLITE_PATH", "./data/minutes.db"),
  uploadDir: opt("UPLOAD_DIR", "./data/uploads"),
  exportDir: opt("EXPORT_DIR", "./data/exports"),

  ollama: {
    baseUrl: opt("OLLAMA_BASE_URL", "http://10.3.8.14:11434"),
    defaultModel: opt("OLLAMA_DEFAULT_MODEL", "llama3.1:8b"),
  },
  anthropic: {
    apiKey: opt("ANTHROPIC_API_KEY"),
    model: opt("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
  },
  gemini: {
    apiKey: opt("GOOGLE_API_KEY"),
    ocrModel: opt("GEMINI_OCR_MODEL", "gemini-3.5"),
    chatModel: opt("GEMINI_CHAT_MODEL", "gemini-3.5"),
  },
  openai: {
    apiKey: opt("OPENAI_API_KEY"),
    model: opt("OPENAI_MODEL", "gpt-5.4"),
  },
};

export function availableProviders(): Array<"ollama" | "claude" | "gemini" | "openai"> {
  const list: Array<"ollama" | "claude" | "gemini" | "openai"> = [];
  if (env.ollama.baseUrl) list.push("ollama");
  if (env.anthropic.apiKey) list.push("claude");
  if (env.gemini.apiKey) list.push("gemini");
  if (env.openai.apiKey) list.push("openai");
  return list;
}
