import { serve } from "@hono/node-server";

import { AgentMemoryService } from "./agent-memory.js";
import { assertConfig, getConfig } from "./config.js";
import { BrainService } from "./brain.js";
import { createPool } from "./db.js";
import { createApp } from "./app.js";
import { IngestionService } from "./ingestion.js";
import { AiProvider } from "./provider.js";

const config = getConfig();
assertConfig(config, { requireAuth: true });
const pool = createPool(config);
const provider = new AiProvider(config);
const brain = new BrainService(pool, config, provider);
const ingestion = new IngestionService(pool, config, provider);
const agentMemory = new AgentMemoryService(pool, config, provider);
const app = createApp(config, brain, ingestion, agentMemory);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port });
ingestion.startWorker();

console.log(`OB1 OCI API listening on ${config.host}:${config.port}`);
console.log(`Embedding contract: text-embedding-3-large / ${config.embeddingDimensions} / halfvec / cosine`);
console.log(`Inference contract: ${config.openAiChatModel} / reasoning ${config.reasoningEffort}`);

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down`);
  ingestion.stopWorker();
  server.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
