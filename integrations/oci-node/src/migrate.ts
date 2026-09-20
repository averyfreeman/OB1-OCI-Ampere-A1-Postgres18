import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertConfig, getConfig } from "./config.js";
import { createPool, withTransaction } from "./db.js";

const config = getConfig();
assertConfig(config);
const pool = createPool(config);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const migrationCandidates = [join(moduleDir, "../migrations"), join(moduleDir, "../../migrations")];
let migrationDir = migrationCandidates[0];
for (const candidate of migrationCandidates) {
  try {
    await fs.access(candidate);
    migrationDir = candidate;
    break;
  } catch {
    // Try the compiled-layout candidate next.
  }
}

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(migrationDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
    if (exists.rowCount) continue;
    const sql = await fs.readFile(join(migrationDir, file), "utf8");
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
    console.log(`Applied ${file}`);
  }
  console.log("Database migrations complete");
} finally {
  await pool.end();
}
