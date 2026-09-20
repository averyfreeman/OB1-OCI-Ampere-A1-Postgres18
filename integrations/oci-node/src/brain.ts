import type { Pool } from "pg";

import type { Ob1Config } from "./config.js";
import { compactFingerprint, isRestricted, normalizeThought, sha256Hex, vectorLiteral } from "./db.js";
import { AiProvider } from "./provider.js";

const SORT_COLUMNS = new Set(["created_at", "updated_at", "importance", "quality_score", "type", "source_type", "status"]);

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function numberArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(a.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  const bTokens = new Set(b.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1;
  return intersection / new Set([...aTokens, ...bTokens]).size;
}

export class BrainService {
  constructor(
    private readonly pool: Pool,
    private readonly config: Ob1Config,
    private readonly provider: AiProvider
  ) {}

  async listThoughts(url: URL) {
    const page = intParam(url.searchParams.get("page"), 1, 1, 100_000);
    const perPage = intParam(url.searchParams.get("per_page"), 25, 1, 100);
    const offset = (page - 1) * perPage;
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(`${clause} $${values.length}`);
    };
    if (url.searchParams.get("exclude_restricted") !== "false") where.push("sensitivity_tier <> 'restricted'");
    if (url.searchParams.get("type")) add("type =", url.searchParams.get("type"));
    if (url.searchParams.get("source_type")) add("source_type =", url.searchParams.get("source_type"));
    if (url.searchParams.get("status")) {
      const statuses = url.searchParams.get("status")!.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
      if (statuses.length) {
        values.push(statuses);
        where.push(`status = ANY($${values.length}::text[])`);
      }
    }
    const importance = url.searchParams.get("importance_min");
    if (importance !== null) add("importance >=", Number(importance));
    const quality = url.searchParams.get("quality_score_max");
    if (quality !== null) add("quality_score <=", Number(quality));
    values.push(perPage, offset);
    const sortCandidate = url.searchParams.get("sort") || "created_at";
    const sort = SORT_COLUMNS.has(sortCandidate) ? sortCandidate : "created_at";
    const order = url.searchParams.get("order") === "asc" ? "ASC" : "DESC";
    const result = await this.pool.query(
      `SELECT id, content, metadata, type, source_type, importance, quality_score,
              sensitivity_tier, status, status_updated_at, created_at, updated_at,
              count(*) OVER () AS total_count
       FROM thoughts
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${sort} ${order} NULLS LAST
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = Number(result.rows[0]?.total_count || 0);
    return { data: result.rows.map((row) => normalizeThought(row)), total, page, per_page: perPage };
  }

  async getThought(id: string, excludeRestricted = true) {
    const result = await this.pool.query(
      `SELECT id, content, metadata, type, source_type, importance, quality_score,
              sensitivity_tier, status, status_updated_at, created_at, updated_at
       FROM thoughts WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;
    if (excludeRestricted && isRestricted(result.rows[0])) return { restricted: true };
    const thought = normalizeThought(result.rows[0]);
    const sources = await this.pool.query(
      `SELECT s.file_id, s.locator, s.extraction_method, s.generated,
              f.original_name, f.mime_type, f.status AS file_status
       FROM thought_sources s JOIN ingested_files f ON f.id = s.file_id
       WHERE s.thought_id = $1 ORDER BY s.created_at`,
      [id]
    );
    return { ...thought, sources: sources.rows.map((row) => ({
      file_id: String(row.file_id),
      original_name: row.original_name,
      mime_type: row.mime_type,
      file_status: row.file_status,
      locator: row.locator || {},
      extraction_method: row.extraction_method,
      generated: Boolean(row.generated),
    })) };
  }

  async updateThought(id: string, patch: Record<string, unknown>) {
    const current = await this.pool.query("SELECT * FROM thoughts WHERE id = $1", [id]);
    if (!current.rows[0]) return null;
    const row = current.rows[0];
    const content = typeof patch.content === "string" ? patch.content.trim() : String(row.content);
    const metadata = { ...(row.metadata || {}), ...(patch.metadata && typeof patch.metadata === "object" ? patch.metadata : {}) };
    const values: unknown[] = [id, content, JSON.stringify(metadata)];
    const sets = ["content = $2", "metadata = $3::jsonb"];
    if (typeof patch.type === "string") {
      values.push(patch.type);
      sets.push(`type = $${values.length}`);
      metadata.type = patch.type;
    }
    for (const field of ["importance", "quality_score", "status", "sensitivity_tier"] as const) {
      if (patch[field] !== undefined) {
        values.push(patch[field]);
        sets.push(`${field} = $${values.length}`);
        if (field === "status") sets.push("status_updated_at = now()");
      }
    }
    if (content !== row.content) {
      const embedding = await this.provider.embedMany([content]);
      values.push(vectorLiteral(embedding.value[0], this.config.embeddingDimensions));
      sets.push(`embedding = $${values.length}::halfvec(3072)`);
      values.push(sha256Hex(compactFingerprint(content)));
      sets.push(`content_fingerprint = $${values.length}`);
    }
    values[2] = JSON.stringify(metadata);
    const updated = await this.pool.query(
      `UPDATE thoughts SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`,
      values
    );
    return updated.rows[0] ? { id, action: "updated", message: "Thought updated" } : null;
  }

  async deleteThought(id: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM thoughts WHERE id = $1", [id]);
    return (result.rowCount || 0) > 0;
  }

  async search(body: {
    query: string;
    mode: "semantic" | "text";
    limit: number;
    page: number;
    threshold: number;
    exclude_restricted: boolean;
  }) {
    const offset = (body.page - 1) * body.limit;
    if (body.mode === "text") {
      const result = await this.pool.query(
        "SELECT * FROM search_thoughts_text($1, $2, $3, $4)",
        [body.query, body.limit, offset, body.exclude_restricted]
      );
      const total = Number(result.rows[0]?.total_count || 0);
      return {
        results: result.rows.map((row) => normalizeThought(row, { rank: row.rank })),
        count: result.rows.length,
        total,
        page: body.page,
        per_page: body.limit,
        total_pages: Math.max(1, Math.ceil(total / body.limit)),
        mode: "text",
      };
    }

    const embedding = await this.provider.embedMany([body.query]);
    const result = await this.pool.query(
      "SELECT * FROM match_thoughts($1::halfvec(3072), $2, $3, $4)",
      [vectorLiteral(embedding.value[0], this.config.embeddingDimensions), body.threshold, Math.min(100, body.limit * body.page * 3), body.exclude_restricted]
    );
    const ordered = result.rows.map((row, index) => normalizeThought(row, { similarity: Number(row.similarity), rank: offset + index + 1 }));
    return {
      results: ordered.slice(offset, offset + body.limit),
      count: Math.min(body.limit, Math.max(0, ordered.length - offset)),
      total: ordered.length,
      page: body.page,
      per_page: body.limit,
      total_pages: Math.max(1, Math.ceil(ordered.length / body.limit)),
      mode: "semantic",
    };
  }

  async stats(days: number, excludeRestricted: boolean) {
    const result = await this.pool.query("SELECT brain_stats_aggregate($1, $2) AS stats", [days, excludeRestricted]);
    const data = result.rows[0]?.stats || {};
    const typeEntries = Array.isArray(data.top_types) ? data.top_types : [];
    return {
      total_thoughts: Number(data.total || 0),
      window_days: days || "all",
      types: Object.fromEntries(typeEntries.map((entry: any) => [entry.type || "unknown", Number(entry.count || 0)])),
      top_topics: Array.isArray(data.top_topics) ? data.top_topics : [],
    };
  }

  async duplicates(threshold: number, limit: number, offset: number) {
    const result = await this.pool.query(
      `SELECT id, content, type, quality_score, created_at
       FROM thoughts ORDER BY created_at DESC LIMIT 500`
    );
    const pairs: Record<string, unknown>[] = [];
    for (let i = 0; i < result.rows.length; i += 1) {
      for (let j = i + 1; j < result.rows.length; j += 1) {
        const a = result.rows[i];
        const b = result.rows[j];
        const similarity = compactFingerprint(a.content) === compactFingerprint(b.content) ? 1 : tokenSimilarity(a.content, b.content);
        if (similarity >= threshold) {
          pairs.push({
            thought_id_a: String(a.id), thought_id_b: String(b.id), similarity,
            content_a: a.content, content_b: b.content, type_a: a.type, type_b: b.type,
            quality_a: Number(a.quality_score), quality_b: Number(b.quality_score),
            created_a: a.created_at, created_b: b.created_at,
          });
        }
      }
    }
    pairs.sort((a, b) => Number(b.similarity) - Number(a.similarity));
    return { pairs: pairs.slice(offset, offset + limit), threshold, limit, offset };
  }

  async connections(id: string, limit: number, excludeRestricted: boolean) {
    const result = await this.pool.query("SELECT * FROM get_thought_connections($1, $2, $3)", [id, limit, excludeRestricted]);
    return { connections: result.rows };
  }

  async reflections(id: string) {
    const result = await this.pool.query("SELECT * FROM reflections WHERE thought_id = $1 ORDER BY created_at DESC", [id]);
    return result.rows.map((row) => ({
      id: String(row.id), thought_id: String(row.thought_id), trigger_context: row.trigger_context,
      options: row.options || [], factors: row.factors || [], conclusion: row.conclusion,
      confidence: Number(row.confidence), reflection_type: row.reflection_type,
      metadata: row.metadata || {}, created_at: new Date(row.created_at).toISOString(),
    }));
  }

  async addReflection(id: string, payload: Record<string, unknown>) {
    const result = await this.pool.query(
      `INSERT INTO reflections (thought_id, trigger_context, options, factors, conclusion, confidence, reflection_type, metadata)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb) RETURNING *`,
      [
        id,
        typeof payload.trigger_context === "string" ? payload.trigger_context : "",
        JSON.stringify(Array.isArray(payload.options) ? payload.options : []),
        JSON.stringify(Array.isArray(payload.factors) ? payload.factors : []),
        typeof payload.conclusion === "string" ? payload.conclusion : "",
        Number(payload.confidence ?? 0.75),
        typeof payload.reflection_type === "string" ? payload.reflection_type : "reflection",
        JSON.stringify(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
      ]
    );
    return result.rows[0];
  }

  async health() {
    const result = await this.pool.query("SELECT current_database() AS database, now() AS now");
    return {
      ok: true,
      status: "ok",
      service: "ob1-oci-node",
      database: result.rows[0]?.database,
      embedding_model: "text-embedding-3-large",
      embedding_dimensions: this.config.embeddingDimensions,
      chat_model: this.config.openAiChatModel,
      providers: [
        ...(this.config.openAiApiKey ? ["openai"] : []),
        ...(this.config.openRouterApiKey ? ["openrouter"] : []),
      ],
    };
  }
}
