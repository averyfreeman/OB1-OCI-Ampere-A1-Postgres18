import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

import type { Pool, PoolClient } from "pg";

import type { Ob1Config } from "./config.js";
import { compactFingerprint, normalizeThought, sha256Hex, vectorLiteral, withTransaction } from "./db.js";
import { chunkText, detectFile, extractFile, type DetectedFile, type ExtractedBlock } from "./extractors.js";
import { extractMetadata, fallbackMetadata, imageMetadata } from "./metadata.js";
import { AiProvider } from "./provider.js";

export interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  extension: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  status: string;
  extractor: string | null;
  extracted_count: number;
  generated_count: number;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

export interface UploadResult {
  file: FileRecord;
  job_id: string | null;
  deduplicated: boolean;
}

interface Candidate {
  content: string;
  locator?: Record<string, unknown>;
  method: string;
  generated: boolean;
  metadata: Record<string, unknown>;
}

interface JobRow {
  id: string;
  file_id: string | null;
  source_label: string;
  source_kind: string;
  status: string;
  attempts: number;
  metadata: Record<string, unknown>;
}

function safeOriginalName(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/[\\/]+/g, "_").trim();
  return (cleaned || "uploaded-file").slice(0, 240);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function imageContent(value: Record<string, unknown>, fileName: string): string {
  const title = textValue(value.title);
  const description = textValue(value.description);
  const visibleText = arrayText(value.visible_text);
  return [title, description, visibleText.length ? `Visible text: ${visibleText.join(" | ")}` : `Image source: ${fileName}`]
    .filter(Boolean)
    .join("\n\n");
}

function sourceMetadata(
  metadata: Record<string, unknown>,
  candidate: Candidate,
  sourceType: string,
  embeddingProvider: string,
  embeddingModel: string,
  file?: FileRecord
): Record<string, unknown> {
  const evidenceStatus = typeof metadata.evidence_status === "string" && metadata.evidence_status.trim()
    ? metadata.evidence_status
    : "explicit";
  return {
    ...metadata,
    type: textValue(metadata.type) || "observation",
    source: sourceType,
    source_type: sourceType,
    embedding_provider: embeddingProvider,
    embedding_model: embeddingModel,
    embedding_dimensions: 3072,
    evidence_status: candidate.generated ? "unconfirmed" : evidenceStatus,
    content_origin: candidate.generated ? "vision_generated" : "source_text",
    ...(file ? {
      source_file_id: file.id,
      source_file_name: file.original_name,
      source_locator: candidate.locator || {},
      extraction_method: candidate.method,
    } : {}),
  };
}

function parseFileRow(row: any): FileRecord {
  return {
    id: String(row.id),
    original_name: String(row.original_name),
    mime_type: String(row.mime_type),
    extension: String(row.extension),
    byte_size: Number(row.byte_size),
    sha256: String(row.sha256),
    storage_key: String(row.storage_key),
    status: String(row.status),
    extractor: row.extractor ? String(row.extractor) : null,
    extracted_count: Number(row.extracted_count || 0),
    generated_count: Number(row.generated_count || 0),
    error_code: row.error_code ? String(row.error_code) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at || row.created_at).toISOString(),
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    deleted_at: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  };
}

export class IngestionService {
  private workerRunning = false;

  constructor(
    private readonly pool: Pool,
    private readonly config: Ob1Config,
    private readonly provider: AiProvider
  ) {}

  private filePath(file: FileRecord): string {
    const root = resolve(this.config.uploadRoot);
    const path = resolve(join(root, file.storage_key));
    if (path !== root && !path.startsWith(`${root}/`)) throw new Error("Invalid storage key");
    return path;
  }

  async upload(originalName: string, buffer: Buffer, declaredMime?: string): Promise<UploadResult> {
    if (!buffer.length) throw new Error("Uploaded file is empty");
    if (buffer.length > this.config.maxFileBytes) throw new Error(`File exceeds ${this.config.maxFileBytes} byte limit`);
    const detected = await detectFile(originalName, buffer);
    const sha256 = sha256Hex(buffer);
    const duplicate = await this.pool.query(
      "SELECT * FROM ingested_files WHERE sha256 = $1 AND status <> 'deleted' LIMIT 1",
      [sha256]
    );
    if (duplicate.rows[0]) {
      const file = parseFileRow(duplicate.rows[0]);
      return { file, job_id: await this.latestJobId(file.id), deduplicated: true };
    }

    const usage = await this.pool.query(
      "SELECT coalesce(sum(byte_size), 0)::bigint AS bytes FROM ingested_files WHERE status <> 'deleted'"
    );
    const used = Number(usage.rows[0]?.bytes || 0);
    if (used + buffer.length > this.config.uploadQuotaBytes) {
      throw new Error(`Upload quota exceeded: ${used} of ${this.config.uploadQuotaBytes} bytes are retained`);
    }

    const id = randomUUID();
    const storageKey = `${id}/${sha256}.${detected.extension || "bin"}`;
    const file: FileRecord = {
      id,
      original_name: safeOriginalName(originalName),
      mime_type: detected.mimeType || declaredMime || "application/octet-stream",
      extension: detected.extension || "bin",
      byte_size: buffer.length,
      sha256,
      storage_key: storageKey,
      status: "queued",
      extractor: detected.kind,
      extracted_count: 0,
      generated_count: 0,
      error_code: null,
      error_message: null,
      metadata: { detected_kind: detected.kind },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      deleted_at: null,
    };
    const absolutePath = this.filePath(file);
    await fs.mkdir(join(this.config.uploadRoot, id), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });
      const result = await withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO ingested_files
            (id, original_name, mime_type, extension, byte_size, sha256, storage_key, status, extractor, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9::jsonb)`,
          [id, file.original_name, file.mime_type, file.extension, file.byte_size, sha256, storageKey, detected.kind, JSON.stringify(file.metadata)]
        );
        const job = await client.query(
          `INSERT INTO ingestion_jobs (file_id, source_label, source_kind, input_hash, status, metadata)
           VALUES ($1, $2, $3, $4, 'queued', $5::jsonb) RETURNING id`,
          [id, file.original_name, detected.kind, sha256, JSON.stringify({ declared_mime: declaredMime || null })]
        );
        return String(job.rows[0].id);
      });
      return { file, job_id: result, deduplicated: false };
    } catch (error) {
      await fs.rm(absolutePath, { force: true }).catch(() => undefined);
      await fs.rm(join(this.config.uploadRoot, id), { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async capture(content: string, sourceType = "dashboard"): Promise<Record<string, unknown>> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("content is required");
    const metadataResult = await extractMetadata(this.provider, trimmed);
    const candidate: Candidate = {
      content: trimmed,
      method: "capture",
      generated: false,
      metadata: metadataResult.metadata,
    };
    const result = await this.saveCandidates([candidate], null, null, sourceType);
    return {
      thought_id: result.thoughtIds[0],
      action: result.addedCount ? "created" : "already_exists",
      type: String(metadataResult.metadata.type || "observation"),
      sensitivity_tier: String(metadataResult.metadata.sensitivity_tier || "standard"),
      content_fingerprint: sha256Hex(compactFingerprint(trimmed)),
      message: result.addedCount ? "Thought captured" : "Thought already existed",
    };
  }

  async ingestText(text: string, dryRun = false): Promise<Record<string, unknown>> {
    const candidates = chunkText(text, this.config.chunkChars, this.config.chunkOverlapChars).map((chunk) => ({
      content: chunk.content,
      locator: { chunk: chunk.index },
      method: "text-ingest",
      generated: false,
      metadata: fallbackMetadata(chunk.content),
    } satisfies Candidate));
    if (!candidates.length) throw new Error("text is required");
    const hash = sha256Hex(text.trim());
    const jobId = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO ingestion_jobs (id, source_label, source_kind, input_hash, status, extracted_count)
         VALUES ($1, 'dashboard text', 'text', $2, $3, $4)`,
        [jobId, hash, dryRun ? "dry_run_complete" : "processing", candidates.length]
      );
      for (const candidate of candidates) {
        await client.query(
          `INSERT INTO ingestion_items (job_id, content, action, status, metadata)
           VALUES ($1, $2, 'add', $3, $4::jsonb)`,
          [jobId, candidate.content, dryRun ? "pending" : "processing", JSON.stringify({ locator: candidate.locator })]
        );
      }
    });
    if (dryRun) {
      return { job_id: jobId, status: "dry_run_complete", extracted_count: candidates.length };
    }
    const result = await this.commitJob(jobId, candidates, null, "dashboard");
    return { job_id: jobId, status: "complete", extracted_count: candidates.length, thought_id: result.thoughtIds[0] };
  }

  async getFile(id: string): Promise<FileRecord | null> {
    const result = await this.pool.query("SELECT * FROM ingested_files WHERE id = $1", [id]);
    return result.rows[0] ? parseFileRow(result.rows[0]) : null;
  }

  async readFile(id: string): Promise<{ file: FileRecord; content: Buffer } | null> {
    const file = await this.getFile(id);
    if (!file || file.status === "deleted") return null;
    return { file, content: await fs.readFile(this.filePath(file)) };
  }

  async deleteFile(id: string): Promise<boolean> {
    const file = await this.getFile(id);
    if (!file) return false;
    await this.pool.query(
      "UPDATE ingested_files SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1",
      [id]
    );
    await fs.rm(this.filePath(file), { force: true }).catch(() => undefined);
    await fs.rm(join(this.config.uploadRoot, file.id), { recursive: true, force: true }).catch(() => undefined);
    return true;
  }

  async reprocessFile(id: string): Promise<{ file_id: string; job_id: string }> {
    const file = await this.getFile(id);
    if (!file || file.status === "deleted") throw new Error("File not found or already deleted");
    const job = await this.pool.query(
      `INSERT INTO ingestion_jobs (file_id, source_label, source_kind, input_hash, status, metadata)
       VALUES ($1, $2, $3, $4, 'queued', '{"reprocess":true}'::jsonb) RETURNING id`,
      [id, file.original_name, file.extractor || "file", file.sha256]
    );
    await this.pool.query(
      "UPDATE ingested_files SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = now() WHERE id = $1",
      [id]
    );
    return { file_id: id, job_id: String(job.rows[0].id) };
  }

  async listFiles(limit = 50): Promise<FileRecord[]> {
    const result = await this.pool.query("SELECT * FROM ingested_files ORDER BY created_at DESC LIMIT $1", [Math.min(Math.max(limit, 1), 100)]);
    return result.rows.map(parseFileRow);
  }

  async listJobs(limit = 50): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query(
      `SELECT j.*, f.original_name, f.status AS file_status
       FROM ingestion_jobs j LEFT JOIN ingested_files f ON f.id = j.file_id
       ORDER BY j.created_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)]
    );
    return result.rows.map((row) => this.jobResponse(row));
  }

  async getJob(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query(
      `SELECT j.*, f.original_name, f.status AS file_status
       FROM ingestion_jobs j LEFT JOIN ingested_files f ON f.id = j.file_id
       WHERE j.id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;
    const items = await this.pool.query("SELECT * FROM ingestion_items WHERE job_id = $1 ORDER BY created_at", [id]);
    return { job: this.jobResponse(result.rows[0]), items: items.rows.map((row) => ({
      id: String(row.id),
      job_id: String(row.job_id),
      content: String(row.content),
      type: String(row.metadata?.type || "observation"),
      fingerprint: sha256Hex(compactFingerprint(String(row.content))),
      action: String(row.action),
      reason: row.reason || null,
      similarity: null,
      status: String(row.status),
      metadata: row.metadata || {},
    })) };
  }

  async executeJob(id: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query("SELECT * FROM ingestion_items WHERE job_id = $1 AND status = 'pending' ORDER BY created_at", [id]);
    if (!result.rows.length) {
      const job = await this.getJob(id);
      if (!job) throw new Error("Ingestion job not found");
      return job;
    }
    const candidates: Candidate[] = result.rows.map((row) => ({
      content: String(row.content),
      locator: row.metadata?.locator || {},
      method: "text-ingest",
      generated: false,
      metadata: fallbackMetadata(String(row.content)),
    }));
    const saved = await this.commitJob(id, candidates, null, "dashboard");
    return (await this.getJob(id)) || { job_id: id, status: "complete", thought_ids: saved.thoughtIds };
  }

  startWorker(): void {
    if (this.workerRunning) return;
    this.workerRunning = true;
    void this.workerLoop();
  }

  stopWorker(): void {
    this.workerRunning = false;
  }

  private async workerLoop(): Promise<void> {
    while (this.workerRunning) {
      try {
        const job = await this.claimJob();
        if (job) await this.processJob(job);
        else await new Promise((resolve) => setTimeout(resolve, this.config.jobPollMs));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, this.config.jobPollMs));
      }
    }
  }

  private async claimJob(): Promise<JobRow | null> {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT id, file_id, source_label, source_kind, status, attempts, metadata
         FROM ingestion_jobs
         WHERE status = 'queued'
            OR (status = 'processing' AND started_at < now() - interval '30 minutes')
         ORDER BY created_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      await client.query(
        `UPDATE ingestion_jobs
         SET status = 'processing', attempts = attempts + 1, started_at = now(), updated_at = now()
         WHERE id = $1`,
        [row.id]
      );
      if (row.file_id) {
        await client.query("UPDATE ingested_files SET status = 'processing', updated_at = now() WHERE id = $1", [row.file_id]);
      }
      return { ...row, id: String(row.id), file_id: row.file_id ? String(row.file_id) : null, metadata: row.metadata || {} } as JobRow;
    });
  }

  private async processJob(job: JobRow): Promise<void> {
    try {
      if (!job.file_id) throw new Error("Queued job has no file");
      const file = await this.getFile(job.file_id);
      if (!file || file.status === "deleted") throw new Error("Source file is unavailable");
      const detected: DetectedFile = { kind: file.extractor as DetectedFile["kind"], mimeType: file.mime_type, extension: file.extension };
      const blocks = await extractFile(this.filePath(file), detected, this.config, file.original_name);
      const candidates: Candidate[] = [];
      let generatedCount = 0;
      for (const block of blocks) {
        let content = block.content;
        let metadata: Record<string, unknown>;
        let method = block.method;
        let generated = block.generated;
        if (block.image) {
          const vision = await this.provider.describeImage(block.image);
          content = imageContent(vision.value, file.original_name);
          metadata = imageMetadata(vision.value, content);
          method = `${block.method}:${vision.provider}`;
          generated = true;
          generatedCount += 1;
        } else {
          const extracted = await extractMetadata(this.provider, content);
          metadata = extracted.metadata;
          if (extracted.provider !== "local") method = `${block.method}:${extracted.provider}`;
        }
        for (const chunk of chunkText(content, this.config.chunkChars, this.config.chunkOverlapChars)) {
          candidates.push({
            content: chunk.content,
            locator: { ...block.locator, chunk: chunk.index },
            method,
            generated,
            metadata,
          });
        }
      }
      await this.pool.query(
        "UPDATE ingestion_jobs SET extracted_count = $2, metadata = metadata || $3::jsonb, updated_at = now() WHERE id = $1",
        [job.id, candidates.length, JSON.stringify({ block_count: blocks.length })]
      );
      const result = await this.commitJob(job.id, candidates, file, `file:${file.mime_type}`);
      await this.pool.query(
        `UPDATE ingested_files
         SET status = 'complete', extractor = $2, extracted_count = $3, generated_count = $4,
             error_code = NULL, error_message = NULL, completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [file.id, detected.kind, result.thoughtIds.length, generatedCount,]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingestion failed";
      const current = await this.pool.query("SELECT attempts FROM ingestion_jobs WHERE id = $1", [job.id]);
      const attempts = Number(current.rows[0]?.attempts || job.attempts || 1);
      const terminal = attempts >= 3;
      await this.pool.query(
        `UPDATE ingestion_jobs
         SET status = $2, error_message = $3, updated_at = now(), completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE completed_at END
         WHERE id = $1`,
        [job.id, terminal ? "failed" : "queued", message.slice(0, 1000)]
      );
      if (job.file_id) {
        await this.pool.query(
          `UPDATE ingested_files SET status = $2, error_code = 'INGESTION_FAILED', error_message = $3, updated_at = now()
           WHERE id = $1`,
          [job.file_id, terminal ? "failed" : "queued", message.slice(0, 1000)]
        );
      }
    }
  }

  private async commitJob(jobId: string, candidates: Candidate[], file: FileRecord | null, sourceType: string) {
    const result = await this.saveCandidates(candidates, file, jobId, sourceType);
    await this.pool.query(
      `UPDATE ingestion_jobs
       SET status = 'complete', added_count = $2, skipped_count = $3,
           updated_at = now(), completed_at = now()
       WHERE id = $1`,
      [jobId, result.addedCount, result.skippedCount]
    );
    return result;
  }

  private async saveCandidates(candidates: Candidate[], file: FileRecord | null, jobId: string | null, sourceType: string) {
    const embeddingResult = await this.provider.embedMany(candidates.map((candidate) => candidate.content));
    const thoughtIds: string[] = [];
    let addedCount = 0;
    let skippedCount = 0;
    await withTransaction(this.pool, async (client) => {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const content = candidate.content.trim();
        const metadata = sourceMetadata(
          candidate.metadata,
          candidate,
          sourceType,
          embeddingResult.provider,
          embeddingResult.model,
          file || undefined
        );
        const fingerprint = sha256Hex(compactFingerprint(content));
        const type = textValue(metadata.type) || "observation";
        const status = ["task", "idea"].includes(type) ? "new" : null;
        const inserted = await client.query(
          `INSERT INTO thoughts
            (content, embedding, content_fingerprint, metadata, type, source_type, importance, quality_score, sensitivity_tier, status, status_updated_at)
           VALUES ($1, $2::halfvec(3072), $3, $4::jsonb, $5, $6, $7, $8, $9, $10::text, CASE WHEN $10::text IS NULL THEN NULL ELSE now() END)
           ON CONFLICT (content_fingerprint) DO UPDATE SET
             metadata = thoughts.metadata || EXCLUDED.metadata,
             updated_at = now()
           RETURNING id, (xmax = 0) AS inserted`,
          [
            content,
            vectorLiteral(embeddingResult.value[index]),
            fingerprint,
            JSON.stringify(metadata),
            type,
            sourceType,
            Math.min(100, Math.max(0, Number(metadata.importance) || 50)),
            (() => {
              const quality = Number(metadata.quality_score);
              return Math.min(100, Math.max(0, Number.isFinite(quality) ? quality : (candidate.generated ? 55 : 70)));
            })(),
            textValue(metadata.sensitivity_tier) || "standard",
            status,
          ]
        );
        const thoughtId = String(inserted.rows[0].id);
        thoughtIds.push(thoughtId);
        if (inserted.rows[0].inserted) addedCount += 1;
        else skippedCount += 1;
        if (file) {
          const locator = candidate.locator || {};
          const locatorHash = sha256Hex(JSON.stringify(locator));
          await client.query(
            `INSERT INTO thought_sources (thought_id, file_id, locator_hash, locator, extraction_method, generated)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             ON CONFLICT (thought_id, file_id, locator_hash) DO NOTHING`,
            [thoughtId, file.id, locatorHash, JSON.stringify(locator), candidate.method, candidate.generated]
          );
        }
        if (jobId) {
          await client.query(
            `UPDATE ingestion_items SET status = 'complete', action = $2, result_thought_id = $3, metadata = metadata || $4::jsonb, updated_at = now()
             WHERE job_id = $1 AND content = $5 AND status IN ('pending', 'processing')`,
            [jobId, inserted.rows[0].inserted ? "add" : "skip", thoughtId, JSON.stringify({ type, source_type: sourceType }), content]
          );
        }
      }
    });
    return { thoughtIds, addedCount, skippedCount };
  }

  private async latestJobId(fileId: string): Promise<string | null> {
    const result = await this.pool.query("SELECT id FROM ingestion_jobs WHERE file_id = $1 ORDER BY created_at DESC LIMIT 1", [fileId]);
    return result.rows[0] ? String(result.rows[0].id) : null;
  }

  private jobResponse(row: any): Record<string, unknown> {
    return {
      id: String(row.id),
      file_id: row.file_id ? String(row.file_id) : null,
      source_label: row.original_name || row.source_label,
      source_kind: row.source_kind,
      status: row.status,
      extracted_count: Number(row.extracted_count || 0),
      added_count: Number(row.added_count || 0),
      skipped_count: Number(row.skipped_count || 0),
      appended_count: Number(row.appended_count || 0),
      revised_count: Number(row.revised_count || 0),
      attempts: Number(row.attempts || 0),
      error_message: row.error_message || null,
      file_status: row.file_status || null,
      metadata: row.metadata || {},
      created_at: new Date(row.created_at).toISOString(),
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    };
  }
}
