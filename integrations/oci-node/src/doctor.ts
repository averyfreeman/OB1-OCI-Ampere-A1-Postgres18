import { assertConfig, getConfig } from "./config.js";
import { createPool, vectorLiteral } from "./db.js";
import { AiProvider } from "./provider.js";

const config = getConfig();
assertConfig(config);
const pool = createPool(config);
const provider = new AiProvider(config);

try {
  const db = await pool.query("SELECT current_database() AS database, extversion FROM pg_extension WHERE extname = 'vector'");
  if (!db.rows[0]?.extversion) throw new Error("pgvector extension is not installed in the configured database");
  const contract = await pool.query("SELECT model_id, dimensions, storage_type, distance_metric FROM embedding_contract WHERE contract_key = 'default'");
  const row = contract.rows[0];
  if (!row || row.model_id !== "text-embedding-3-large" || Number(row.dimensions) !== 3072 || row.storage_type !== "halfvec" || row.distance_metric !== "cosine") {
    throw new Error("Database embedding contract does not match the immutable OCI baseline");
  }
  const probe = await provider.probeEmbedding();
  const values = probe.value[0];
  // Force the same serialization path used by inserts and queries.
  vectorLiteral(values, config.embeddingDimensions);
  const inference = await provider.extractMetadata("OB1 inference contract probe. Return only the required empty metadata arrays and observation type.");
  console.log(JSON.stringify({
    ok: true,
    database: db.rows[0].database,
    pgvector: db.rows[0].extversion,
    embedding: { model: probe.model, provider: probe.provider, dimensions: values.length, storage: "halfvec(3072)", metric: "cosine" },
    inference: { model: inference.model, provider: inference.provider, reasoning: config.reasoningEffort },
  }));
} finally {
  await pool.end();
}
