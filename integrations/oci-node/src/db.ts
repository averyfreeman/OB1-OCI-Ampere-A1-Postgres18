import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { Ob1Config } from "./config.js";

export function createPool(config: Ob1Config): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function vectorLiteral(values: number[], dimensions = 3072): string {
  if (values.length !== dimensions) {
    throw new Error(`Embedding dimension mismatch: expected ${dimensions}, received ${values.length}`);
  }
  if (!values.every((value) => Number.isFinite(value))) {
    throw new Error("Embedding contains a non-finite value");
  }
  return `[${values.join(",")}]`;
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeThought(row: QueryResultRow, extra: Record<string, unknown> = {}) {
  const metadata = objectValue(row.metadata);
  return {
    id: String(row.id),
    uuid: String(row.id),
    content: String(row.content || ""),
    type: stringValue(row.type || metadata.type, "observation"),
    source_type: stringValue(row.source_type || metadata.source_type || metadata.source, "unknown"),
    importance: numberValue(row.importance ?? metadata.importance, 50),
    quality_score: numberValue(row.quality_score ?? metadata.quality_score, 70),
    sensitivity_tier: stringValue(row.sensitivity_tier || metadata.sensitivity_tier, "standard"),
    metadata,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at || row.created_at).toISOString(),
    status: row.status ?? null,
    status_updated_at: row.status_updated_at ? new Date(row.status_updated_at).toISOString() : null,
    ...extra,
  };
}

export function isRestricted(row: QueryResultRow): boolean {
  const metadata = objectValue(row.metadata);
  return row.sensitivity_tier === "restricted" || metadata.sensitivity_tier === "restricted";
}

export function compactFingerprint(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
