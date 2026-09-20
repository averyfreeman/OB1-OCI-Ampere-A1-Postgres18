import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

import { buildScopeGrants, type ScopeGrant } from "./scope.js";

// The systemd unit supplies OB1_ENV_FILE. Local development falls back to the
// repository root .env without ever copying its values into source control.
if (process.env.OB1_ENV_FILE) loadDotenv({ path: process.env.OB1_ENV_FILE, override: false });
else loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), override: false });

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function csv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  return value === undefined
    ? fallback
    : value.split(",").map((item) => item.trim()).filter(Boolean);
}

export interface Ob1Config {
  host: string;
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  brainKey: string;
  defaultWorkspaceId: string;
  scopeGrants: ScopeGrant[];
  openAiApiKey: string;
  openRouterApiKey: string;
  openAiBaseUrl: string;
  openRouterBaseUrl: string;
  openAiChatModel: string;
  openRouterChatModel: string;
  openAiEmbeddingModel: string;
  openRouterEmbeddingModel: string;
  embeddingDimensions: number;
  reasoningEffort: string;
  uploadRoot: string;
  maxFileBytes: number;
  uploadQuotaBytes: number;
  chunkChars: number;
  chunkOverlapChars: number;
  maxPdfPages: number;
  maxVisionPages: number;
  corsOrigins: string[];
  jobPollMs: number;
  requestTimeoutMs: number;
}

export function getConfig(): Ob1Config {
  const brainKey = process.env.OB1_BRAIN_KEY || process.env.MCP_ACCESS_KEY || "";
  const defaultWorkspaceId = process.env.OB1_DEFAULT_WORKSPACE_ID || "default";
  return {
    host: process.env.OB1_HOST || "0.0.0.0",
    port: integer("OB1_PORT", 8787),
    databaseUrl: process.env.DATABASE_URL || "postgresql://ob1_app@127.0.0.1:5432/ob1",
    databaseSsl: boolean("DATABASE_SSL", false),
    brainKey,
    defaultWorkspaceId,
    scopeGrants: buildScopeGrants(brainKey, defaultWorkspaceId, process.env.OB1_SCOPE_GRANTS_JSON),
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
    openAiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    openRouterBaseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    openAiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-5.6-luna",
    openRouterChatModel: process.env.OPENROUTER_CHAT_MODEL || "openai/gpt-5.6-luna",
    openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large",
    openRouterEmbeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-large",
    embeddingDimensions: integer("OB1_EMBEDDING_DIMENSIONS", 3072),
    reasoningEffort: process.env.OB1_REASONING_EFFORT || "max",
    uploadRoot: process.env.OB1_UPLOAD_ROOT || "/var/lib/ob1/uploads",
    maxFileBytes: integer("OB1_MAX_FILE_BYTES", 25 * 1024 * 1024),
    uploadQuotaBytes: integer("OB1_UPLOAD_QUOTA_BYTES", 2 * 1024 * 1024 * 1024),
    chunkChars: integer("OB1_CHUNK_CHARS", 6000),
    chunkOverlapChars: integer("OB1_CHUNK_OVERLAP_CHARS", 600),
    maxPdfPages: integer("OB1_MAX_PDF_PAGES", 200),
    maxVisionPages: integer("OB1_MAX_VISION_PAGES", 50),
    corsOrigins: csv("OB1_CORS_ORIGINS", ["http://100.113.183.43:3000", "http://192.168.0.30:3000"]),
    jobPollMs: integer("OB1_JOB_POLL_MS", 1000),
    requestTimeoutMs: integer("OB1_REQUEST_TIMEOUT_MS", 120_000),
  };
}

export function assertConfig(config: Ob1Config, options: { requireAuth?: boolean } = {}): void {
  if (config.embeddingDimensions !== 3072) {
    throw new Error("OB1_EMBEDDING_DIMENSIONS must remain 3072; the OCI embedding contract is immutable");
  }
  if (config.reasoningEffort !== "max") {
    throw new Error("OB1_REASONING_EFFORT must remain max for the configured Luna inference contract");
  }
  if (options.requireAuth && !config.brainKey) {
    throw new Error("OB1_BRAIN_KEY or MCP_ACCESS_KEY is required");
  }
  if (!config.openAiApiKey && !config.openRouterApiKey) {
    throw new Error("OPENAI_API_KEY or OPENROUTER_API_KEY is required");
  }
  if (config.maxFileBytes <= 0 || config.uploadQuotaBytes < config.maxFileBytes) {
    throw new Error("Upload limits are invalid");
  }
  if (config.chunkOverlapChars < 0 || config.chunkOverlapChars >= config.chunkChars) {
    throw new Error("OB1_CHUNK_OVERLAP_CHARS must be smaller than OB1_CHUNK_CHARS");
  }
}
