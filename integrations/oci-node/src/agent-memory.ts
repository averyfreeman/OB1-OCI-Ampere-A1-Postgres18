import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";

import type { Ob1Config } from "./config.js";
import { compactFingerprint, objectValue, sha256Hex, vectorLiteral, withTransaction } from "./db.js";
import { INTENT_DOMAINS, IntentResolver, type IntentDomain, type IntentResolution } from "./intent.js";
import { AiProvider } from "./provider.js";
import {
  SCOPE_CAPABILITIES,
  SCOPE_MODES,
  SCOPE_VISIBILITIES,
  allowsValue,
  assertScopeGrantCanUse,
  canUseVisibility,
  effectiveAgentId,
  hasScopeCapability,
  type ScopeGrant,
  type ScopeMode,
  type ScopeVisibility,
} from "./scope.js";

const schemaVersion = z.union([
  z.literal("openbrain.agent_memory.recall.v1"),
  z.literal("openbrain.openclaw.recall.v1"),
]);
const writebackSchemaVersion = z.union([
  z.literal("openbrain.agent_memory.writeback.v1"),
  z.literal("openbrain.openclaw.writeback.v1"),
]);

const nullableString = z.string().trim().min(1).nullable().optional();
const channelSchema = z.object({
  kind: nullableString,
  id: nullableString,
  thread_id: nullableString,
}).default({});
const runtimeSchema = z.object({
  name: z.string().trim().min(1).default("unknown"),
  version: nullableString,
}).default({ name: "unknown" });
const modelIntentSchema = z.object({
  provider: nullableString,
  model: nullableString,
  primary: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).default({});

const scopeSchema = z.object({
  visibility: z.enum(SCOPE_VISIBILITIES).nullable().optional(),
  mode: z.enum(SCOPE_MODES).optional(),
  project_only: z.boolean().default(true),
  include_unconfirmed: z.boolean().default(false),
  include_stale: z.boolean().default(false),
  domain_mode: z.enum(["rank", "only"]).default("rank"),
  domain: z.enum([...INTENT_DOMAINS, "unknown"] as [string, ...string[]]).optional(),
}).default({ project_only: true, include_unconfirmed: false, include_stale: false, domain_mode: "rank" });

const limitsSchema = z.object({
  max_items: z.number().int().min(1).max(50).default(10),
  max_tokens: z.number().int().min(256).max(20_000).default(4_000),
  recency_days: z.number().int().positive().nullable().optional(),
}).default({ max_items: 10, max_tokens: 4_000 });

export const recallRequestSchema = z.object({
  schema_version: schemaVersion,
  workspace_id: z.string().trim().min(1).optional(),
  project_id: nullableString,
  session_id: nullableString,
  agent_id: nullableString,
  client_surface: nullableString,
  task_id: nullableString,
  flow_id: nullableString,
  task_type: nullableString,
  channel: channelSchema,
  runtime: runtimeSchema,
  model_intent: modelIntentSchema,
  intent_hint: z.string().trim().optional(),
  query: z.string().trim().min(1).max(20_000),
  entities: z.record(z.string(), z.array(z.string())).default({}),
  scope: scopeSchema,
  limits: limitsSchema,
  sensitivity: z.record(z.string(), z.boolean()).default({}),
});

const memoryPayloadSchema = z.object({
  decisions: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  outputs: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  lessons: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  constraints: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  unresolved_questions: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  next_steps: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  failures: z.array(z.string().trim().min(1).max(15_000)).max(50).default([]),
  artifacts: z.array(z.object({
    kind: z.string().trim().min(1).max(200),
    uri: z.string().trim().min(1).max(2_000),
    description: z.string().trim().max(2_000).nullable().optional(),
  })).max(50).default([]),
  entities: z.record(z.string(), z.array(z.string())).default({}),
});

export const writebackRequestSchema = z.object({
  schema_version: writebackSchemaVersion,
  workspace_id: z.string().trim().min(1).optional(),
  project_id: nullableString,
  session_id: nullableString,
  agent_id: nullableString,
  client_surface: nullableString,
  task_id: nullableString,
  flow_id: nullableString,
  step_id: nullableString,
  task_type: nullableString,
  idempotency_key: nullableString,
  content_hash: nullableString,
  channel: channelSchema,
  runtime: runtimeSchema,
  model_intent: modelIntentSchema,
  intent_hint: z.string().trim().optional(),
  models_used: z.array(z.object({
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    role: z.string().trim().min(1),
  })).max(20).default([]),
  source_refs: z.array(z.object({
    kind: z.string().trim().min(1).max(200),
    uri: nullableString,
    title: nullableString,
    timestamp: nullableString,
  })).max(100).default([]),
  memory_payload: memoryPayloadSchema,
  provenance: z.object({
    default_status: z.enum(["observed", "inferred", "user_confirmed", "imported", "generated"]).default("generated"),
    confidence: z.number().min(0).max(1).default(0.5),
    requires_review: z.boolean().default(true),
  }).default({ default_status: "generated", confidence: 0.5, requires_review: true }),
  retention: z.object({
    ttl_days: z.number().int().positive().nullable().optional(),
    stale_after_days: z.number().int().positive().nullable().optional(),
  }).default({}),
  visibility: z.object({
    level: z.enum(SCOPE_VISIBILITIES).optional(),
    workspace: z.string().nullable().optional(),
    project: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
  }).default({}),
});

export const usageRequestSchema = z.object({
  used_memory_ids: z.array(z.string().trim().min(1)).max(100).default([]),
  ignored: z.array(z.object({
    memory_id: z.string().trim().min(1),
    reason: z.string().trim().max(500).optional(),
  })).max(100).default([]),
});

export const reviewRequestSchema = z.object({
  action: z.enum(["confirm", "edit", "evidence_only", "restrict_scope", "mark_stale", "merge", "reject", "dispute", "supersede"]),
  actor_id: nullableString,
  actor_label: nullableString,
  notes: z.string().trim().max(4_000).nullable().optional(),
  content: z.string().trim().min(1).max(15_000).optional(),
  summary: z.string().trim().min(1).max(2_000).optional(),
  visibility: z.enum(SCOPE_VISIBILITIES).optional(),
  related_memory_id: z.string().trim().min(1).optional(),
});

export type RecallRequest = z.infer<typeof recallRequestSchema>;
export type WritebackRequest = z.infer<typeof writebackRequestSchema>;
export type RecallUsageRequest = z.infer<typeof usageRequestSchema>;
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export type ResolvedContext = {
  workspaceId: string;
  projectId: string | undefined;
  sessionId: string | undefined;
  agentId: string;
  clientSurface: string | undefined;
  taskId: string | undefined;
  flowId: string | undefined;
  runtimeName: string;
  runtimeVersion: string | undefined;
  channelKind: string | undefined;
  channelId: string | undefined;
  channelThreadId: string | undefined;
};

type MemoryCandidate = {
  memoryType: "decision" | "output" | "lesson" | "constraint" | "open_question" | "failure" | "artifact_reference" | "work_log";
  content: string;
  artifact?: { kind: string; uri: string; description?: string | null };
};

type RankedMemory = QueryResultRow & {
  similarity?: number;
  lexical_score?: number;
  ranking_score?: number;
};

type ScopeFilter = { sql: string; values: unknown[] };
type ScopeRequest = z.infer<typeof scopeSchema>;

const MEMORY_TYPES: MemoryCandidate["memoryType"][] = [
  "decision", "output", "lesson", "constraint", "open_question", "failure", "artifact_reference", "work_log",
];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function optionalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function staleAfter(days: number | null | undefined): Date | undefined {
  if (!days) return undefined;
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value;
}

function sanitizeDurableText(value: string, max = 12_000): string {
  return value
    .replace(/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/gi, "[private key redacted]")
    .replace(/(?:api[_ -]?key|access[_ -]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(?:sk|rk|pk|sk-or-v1)-[A-Za-z0-9_-]{12,}\b/g, "[credential redacted]")
    .replace(/\b(?:user|assistant|system|agent|human):/gi, "$1:")
    .slice(0, max)
    .trim();
}

function unsafeReasons(value: string): string[] {
  const reasons: string[] = [];
  if (/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i.test(value)) reasons.push("private_key");
  if (/(?:sk-[A-Za-z0-9_-]{12,}|sk-or-v1-[A-Za-z0-9_-]{12,})/.test(value)) reasons.push("api_key");
  if (/(?:password|passwd|secret|token)\s*[:=]\s*\S{12,}/i.test(value)) reasons.push("credential_like_string");
  if ((value.match(/```/g) || []).length >= 4 || value.split("\n").filter((line) => line.length > 120).length > 20) reasons.push("large_code_block");
  if (value.length > 15_000 || value.split("\n").filter((line) => /^(user|assistant|system|agent|human):/i.test(line.trim())).length > 8) reasons.push("raw_transcript_like");
  return reasons;
}

function memoryCandidates(payload: WritebackRequest["memory_payload"]): MemoryCandidate[] {
  const rows: MemoryCandidate[] = [];
  for (const content of payload.decisions) rows.push({ memoryType: "decision", content });
  for (const content of payload.outputs) rows.push({ memoryType: "output", content });
  for (const content of payload.lessons) rows.push({ memoryType: "lesson", content });
  for (const content of payload.constraints) rows.push({ memoryType: "constraint", content });
  for (const content of payload.unresolved_questions) rows.push({ memoryType: "open_question", content });
  for (const content of payload.next_steps) rows.push({ memoryType: "work_log", content: `Next step: ${content}` });
  for (const content of payload.failures) rows.push({ memoryType: "failure", content });
  for (const artifact of payload.artifacts) {
    rows.push({
      memoryType: "artifact_reference",
      content: `${artifact.kind}: ${artifact.description || artifact.uri}\n${artifact.uri}`,
      artifact,
    });
  }
  return rows;
}

function responseSchemaFor(requestSchemaVersion: string, kind: "recall" | "writeback"): string {
  if (kind === "recall") {
    return requestSchemaVersion === "openbrain.openclaw.recall.v1"
      ? "openbrain.openclaw.recall_response.v1"
      : "openbrain.agent_memory.recall_response.v1";
  }
  return requestSchemaVersion === "openbrain.openclaw.writeback.v1"
    ? "openbrain.openclaw.writeback_response.v1"
    : "openbrain.agent_memory.writeback_response.v1";
}

function responseMemory(row: QueryResultRow, maxChars = 20_000): Record<string, unknown> {
  const content = String(row.content || "");
  const summary = String(row.summary || content.slice(0, 240));
  const limitedContent = content.length > maxChars ? `${content.slice(0, maxChars)}\n[content truncated]` : content;
  const sourceRefs = Array.isArray(row.source_refs)
    ? row.source_refs
    : Array.isArray(row.agent_memory_source_refs)
      ? row.agent_memory_source_refs
      : [];
  const artifacts = Array.isArray(row.related_artifacts)
    ? row.related_artifacts
    : Array.isArray(row.agent_memory_artifacts)
      ? row.agent_memory_artifacts
      : [];
  const nested = {
    memory_id: String(row.id),
    thought_id: row.thought_id ? String(row.thought_id) : null,
    summary,
    content: limitedContent,
    memory_type: String(row.memory_type || "work_log"),
    intent: {
      primary: String(row.intent_primary || "unknown"),
      scores: objectValue(row.intent_scores),
      source: row.intent_source || null,
      confidence: row.intent_confidence === null || row.intent_confidence === undefined ? null : number(row.intent_confidence),
    },
    source: {
      kind: "agent_memory",
      uri: text(objectValue(row.metadata).source_uri) || null,
      title: summary,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    },
    provenance: {
      status: String(row.provenance_status || "generated"),
      confidence: number(row.confidence, 0.5),
      created_by: String(row.created_by || "agent"),
      provider: row.provider || null,
      model: row.model || null,
      runtime: row.runtime_name || null,
    },
    scope: {
      workspace_id: String(row.workspace_id),
      project_id: row.project_id || null,
      session_id: row.session_id || null,
      agent_id: row.agent_id || null,
      channel_kind: row.channel_kind || null,
      channel_id: row.channel_id || null,
      channel_thread_id: row.channel_thread_id || null,
      visibility: String(row.visibility),
    },
    use_policy: {
      can_use_as_instruction: bool(row.can_use_as_instruction),
      can_use_as_evidence: bool(row.can_use_as_evidence),
      requires_user_confirmation: bool(row.requires_user_confirmation),
      review_status: String(row.review_status || "pending"),
    },
    freshness: {
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      last_confirmed_at: row.last_confirmed_at ? new Date(row.last_confirmed_at).toISOString() : null,
      stale_after: row.stale_after ? new Date(row.stale_after).toISOString() : null,
    },
    ranking: {
      similarity: row.similarity === undefined ? null : number(row.similarity),
      lexical_score: row.lexical_score === undefined ? null : number(row.lexical_score),
      score: row.ranking_score === undefined ? null : number(row.ranking_score),
    },
    metadata: objectValue(row.metadata),
    related_artifacts: artifacts,
  };
  // The top-level aliases keep the existing dashboard and older adapters
  // compatible with the runtime-neutral response envelope.
  return {
    ...nested,
    id: String(row.id),
    thought_id: row.thought_id ? String(row.thought_id) : null,
    workspace_id: String(row.workspace_id),
    project_id: row.project_id || null,
    session_id: row.session_id || null,
    agent_id: row.agent_id || null,
    client_surface: row.client_surface || null,
    channel_kind: row.channel_kind || null,
    channel_id: row.channel_id || null,
    channel_thread_id: row.channel_thread_id || null,
    visibility: String(row.visibility),
    memory_type: String(row.memory_type || "work_log"),
    summary,
    content: limitedContent,
    lifecycle_status: String(row.lifecycle_status || "active"),
    provenance_status: String(row.provenance_status || "generated"),
    confidence: number(row.confidence, 0.5),
    created_by: String(row.created_by || "agent"),
    runtime_name: row.runtime_name || null,
    runtime_version: row.runtime_version || null,
    provider: row.provider || null,
    model: row.model || null,
    task_id: row.task_id || null,
    flow_id: row.flow_id || null,
    can_use_as_instruction: bool(row.can_use_as_instruction),
    can_use_as_evidence: bool(row.can_use_as_evidence),
    requires_user_confirmation: bool(row.requires_user_confirmation),
    review_status: String(row.review_status || "pending"),
    last_confirmed_at: row.last_confirmed_at || null,
    stale_after: row.stale_after || null,
    idempotency_key: row.idempotency_key || null,
    content_hash: row.content_hash || null,
    metadata: objectValue(row.metadata),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    agent_memory_source_refs: sourceRefs,
    agent_memory_artifacts: artifacts,
  };
}

function providerModel(request: WritebackRequest): { provider: string | null; model: string | null } {
  const first = request.models_used[0];
  return { provider: first?.provider || text(request.model_intent.provider) || null, model: first?.model || text(request.model_intent.model) || null };
}

function contextFrom(
  request: Pick<RecallRequest | WritebackRequest, "workspace_id" | "project_id" | "session_id" | "agent_id" | "client_surface" | "task_id" | "flow_id" | "channel" | "runtime">,
  grant: ScopeGrant,
  config: Ob1Config,
): ResolvedContext {
  const projectId = request.project_id ?? grant.defaultProjectId;
  const workspaceId = request.workspace_id || grant.defaultWorkspaceId || config.defaultWorkspaceId;
  return {
    workspaceId,
    projectId: projectId || undefined,
    sessionId: request.session_id || undefined,
    agentId: effectiveAgentId(grant, request.agent_id),
    clientSurface: request.client_surface || undefined,
    taskId: request.task_id || undefined,
    flowId: request.flow_id || undefined,
    runtimeName: request.runtime.name || "unknown",
    runtimeVersion: request.runtime.version || undefined,
    channelKind: request.channel.kind || undefined,
    channelId: request.channel.id || undefined,
    channelThreadId: request.channel.thread_id || undefined,
  };
}

function domainFrom(value: unknown): IntentDomain | "unknown" | undefined {
  return typeof value === "string" && [...INTENT_DOMAINS, "unknown"].includes(value as never)
    ? value as IntentDomain | "unknown"
    : undefined;
}

function safeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function buildScopeFilter(
  context: ResolvedContext,
  grant: ScopeGrant,
  scope: ScopeRequest,
  startIndex: number,
  options: { includeUnconfirmed?: boolean; includeStale?: boolean } = {},
): ScopeFilter {
  const values: unknown[] = [];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${startIndex + values.length - 1}`;
  };

  const clauses: string[] = [`am.workspace_id = ${add(context.workspaceId)}`];
  const requestedVisibility = scope.visibility ? [scope.visibility] : grant.allowedVisibility;
  const allowedVisibility = requestedVisibility.filter((visibility) => canUseVisibility(grant, visibility));
  if (!allowedVisibility.length) {
    clauses.push("FALSE");
  } else {
    clauses.push(`am.visibility = ANY(${add(allowedVisibility)}::text[])`);
  }

  const administrator = hasScopeCapability(grant, "admin");
  const broadWorkspaceRead = administrator
    && (scope.mode || grant.defaultScopeMode) === "workspace"
    && !scope.project_only;
  if (!broadWorkspaceRead) {
    if (context.projectId) {
      clauses.push(`(am.project_id IS NULL OR am.project_id = ${add(context.projectId)})`);
    } else {
      // A request without a project cannot accidentally retrieve another
      // project's memory. Workspace-level memories remain available.
      clauses.push("am.project_id IS NULL");
    }
  }

  if (context.channelKind && context.channelId) {
    const channelKind = add(context.channelKind);
    const channelId = add(context.channelId);
    clauses.push(`(am.visibility <> 'channel' OR (am.channel_kind = ${channelKind} AND am.channel_id = ${channelId}))`);
  } else {
    clauses.push("am.visibility <> 'channel'");
  }

  if (!administrator) {
    const principal = add(context.agentId);
    clauses.push(`(am.visibility <> 'personal' OR am.owner_id = ${principal} OR am.agent_id = ${principal})`);
  }

  if (!options.includeStale && !scope.include_stale) {
    clauses.push("am.lifecycle_status NOT IN ('stale', 'superseded', 'rejected', 'disputed')");
    clauses.push("(am.stale_after IS NULL OR am.stale_after > now())");
  }

  const allowUnconfirmed = options.includeUnconfirmed
    || (scope.include_unconfirmed && grant.allowUnconfirmed);
  if (!allowUnconfirmed) {
    clauses.push("NOT (am.requires_user_confirmation AND am.review_status = 'pending')");
  }

  if (!(administrator && scope.mode === "workspace" && scope.include_stale)) {
    clauses.push("t.sensitivity_tier <> 'restricted'");
  }

  if (scope.mode === "personal") clauses.push("am.visibility = 'personal'");
  if (scope.mode === "project" && context.projectId) {
    clauses.push(`(am.visibility IN ('workspace', 'organization') OR (am.visibility = 'project' AND am.project_id = ${add(context.projectId)}))`);
  }

  return { sql: clauses.join(" AND "), values };
}

function rankingScore(row: RankedMemory, intent: IntentResolution, scope: ScopeRequest): number {
  const semantic = Math.max(0, Math.min(1, number(row.similarity)));
  const lexical = Math.max(0, Math.min(1, number(row.lexical_score) * 4));
  const provenance = row.provenance_status === "user_confirmed" ? 0.16
    : row.provenance_status === "imported" ? 0.12
    : row.provenance_status === "observed" ? 0.08
    : row.provenance_status === "generated" ? 0.03
    : 0;
  const review = row.review_status === "confirmed" ? 0.12
    : row.review_status === "evidence_only" ? 0.05
    : row.review_status === "pending" ? -0.04
    : -0.16;
  const intentAffinity = row.intent_primary === intent.primary
    ? 0.12
    : row.intent_primary === "unknown" || row.intent_primary === "general"
      ? 0.02
      : 0;
  const requestedPersonal = scope.visibility === "personal" || scope.mode === "personal";
  const scopeAffinity = requestedPersonal && row.visibility === "personal" ? 0.08 : 0;
  const confidence = Math.max(0, Math.min(1, number(row.confidence, 0.5))) * 0.08;
  return (semantic * 0.62) + (lexical * 0.18) + provenance + review + intentAffinity + scopeAffinity + confidence;
}

function actorKind(grant: ScopeGrant, request: WritebackRequest["provenance"]): "user" | "agent" | "import" {
  if (request.default_status === "imported" && hasScopeCapability(grant, "review")) return "import";
  if (request.default_status === "user_confirmed" && hasScopeCapability(grant, "review")) return "user";
  return "agent";
}

function visibilityForWriteback(request: WritebackRequest, context: ResolvedContext): ScopeVisibility {
  const explicit = request.visibility.level
    || (request.visibility.project ? "project" : undefined)
    || (request.visibility.channel ? "channel" : undefined)
    || (context.projectId ? "project" : "personal");
  return explicit as ScopeVisibility;
}

function memoryTypeToThoughtType(type: MemoryCandidate["memoryType"]): string {
  if (type === "decision" || type === "lesson") return type;
  if (type === "constraint") return "task";
  if (type === "output" || type === "artifact_reference") return "reference";
  return "observation";
}

function minimalTracePayload(request: RecallRequest): Record<string, unknown> {
  return {
    schema_version: request.schema_version,
    task_type: request.task_type || null,
    entities: request.entities,
    scope: request.scope,
    limits: request.limits,
    sensitivity: request.sensitivity,
  };
}

export class AgentMemoryService {
  private readonly intentResolver: IntentResolver;

  constructor(
    private readonly pool: Pool,
    private readonly config: Ob1Config,
    private readonly provider: AiProvider,
  ) {
    this.intentResolver = new IntentResolver(provider);
  }

  contextFor(
    request: Pick<RecallRequest | WritebackRequest, "workspace_id" | "project_id" | "session_id" | "agent_id" | "client_surface" | "task_id" | "flow_id" | "channel" | "runtime">,
    grant: ScopeGrant,
  ): ResolvedContext {
    const context = contextFrom(request, grant, this.config);
    assertScopeGrantCanUse(grant, { workspaceId: context.workspaceId, projectId: context.projectId });
    return context;
  }

  private async previousIntent(context: ResolvedContext): Promise<Pick<IntentResolution, "primary" | "scores"> | undefined> {
    if (!context.sessionId) return undefined;
    const result = await this.pool.query(
      `SELECT active_domain, domain_scores
       FROM agent_memory_sessions
       WHERE session_id = $1 AND workspace_id = $2
         AND (expires_at IS NULL OR expires_at > now())`,
      [context.sessionId, context.workspaceId],
    );
    const row = result.rows[0];
    const primary = domainFrom(row?.active_domain);
    return primary && primary !== "unknown"
      ? { primary, scores: safeJson(row.domain_scores) as IntentResolution["scores"] }
      : undefined;
  }

  private async resolveIntent(
    context: ResolvedContext,
    query: string,
    hint?: string,
  ): Promise<IntentResolution> {
    return this.intentResolver.resolve({
      query,
      hint,
      prior: await this.previousIntent(context),
    });
  }

  private async saveSession(context: ResolvedContext, intent: IntentResolution, query: string): Promise<void> {
    if (!context.sessionId) return;
    await this.pool.query(
      `INSERT INTO agent_memory_sessions (
         session_id, workspace_id, project_id, agent_id, runtime_name, runtime_version,
         client_surface, channel_kind, channel_id, channel_thread_id,
         active_domain, domain_scores, domain_source, domain_confidence, last_query_hash,
         last_activity, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, now(), now() + interval '30 days')
       ON CONFLICT (session_id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         project_id = EXCLUDED.project_id,
         agent_id = EXCLUDED.agent_id,
         runtime_name = EXCLUDED.runtime_name,
         runtime_version = EXCLUDED.runtime_version,
         client_surface = EXCLUDED.client_surface,
         channel_kind = EXCLUDED.channel_kind,
         channel_id = EXCLUDED.channel_id,
         channel_thread_id = EXCLUDED.channel_thread_id,
         active_domain = EXCLUDED.active_domain,
         domain_scores = EXCLUDED.domain_scores,
         domain_source = EXCLUDED.domain_source,
         domain_confidence = EXCLUDED.domain_confidence,
         last_query_hash = EXCLUDED.last_query_hash,
         last_activity = now(),
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [
        context.sessionId,
        context.workspaceId,
        context.projectId || null,
        context.agentId,
        context.runtimeName,
        context.runtimeVersion || null,
        context.clientSurface || null,
        context.channelKind || null,
        context.channelId || null,
        context.channelThreadId || null,
        intent.primary,
        JSON.stringify(intent.scores),
        intent.source,
        intent.confidence,
        sha256Hex(sanitizeDurableText(query, 6_000)),
      ],
    );
  }

  private async candidateRows(
    request: RecallRequest,
    context: ResolvedContext,
    grant: ScopeGrant,
    intent: IntentResolution,
    embedding: number[],
  ): Promise<RankedMemory[]> {
    const filter = buildScopeFilter(context, grant, request.scope, 3);
    const limit = Math.min(200, Math.max(request.limits.max_items * 8, 40));
    const extraClauses: string[] = [];
    if (request.scope.domain_mode === "only" && request.scope.domain) {
      filter.values.push(request.scope.domain);
      extraClauses.push(`am.intent_primary = $${3 + filter.values.length - 1}`);
    }
    if (request.limits.recency_days) {
      filter.values.push(request.limits.recency_days);
      extraClauses.push(`am.created_at >= now() - ($${3 + filter.values.length - 1}::integer * interval '1 day')`);
    }
    const limitParam = `$${3 + filter.values.length}`;
    const result = await this.pool.query(
      `SELECT am.*,
              (1 - (t.embedding <=> $1::halfvec(3072)))::FLOAT AS similarity,
              ts_rank_cd(
                to_tsvector('simple', coalesce(t.content, '')),
                websearch_to_tsquery('simple', $2)
              )::FLOAT AS lexical_score
       FROM agent_memories am
       JOIN thoughts t ON t.id = am.thought_id
       WHERE ${filter.sql}
         AND (1 - (t.embedding <=> $1::halfvec(3072))) >= 0.15
         ${extraClauses.map((clause) => `AND ${clause}`).join("\n         ")}
       ORDER BY t.embedding <=> $1::halfvec(3072)
       LIMIT ${limitParam}`,
      [
        vectorLiteral(embedding, this.config.embeddingDimensions),
        sanitizeDurableText(request.query, 6_000),
        ...filter.values,
        limit,
      ],
    );

    return result.rows
      .map((row) => ({ ...row, ranking_score: rankingScore(row, intent, request.scope) }))
      .sort((left, right) => number(right.ranking_score) - number(left.ranking_score));
  }

  async recall(request: RecallRequest, grant: ScopeGrant): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "recall")) throw new Error("Scope grant does not allow recall");
    const context = this.contextFor(request, grant);
    const intent = await this.resolveIntent(context, request.query, request.intent_hint || request.model_intent.primary);
    await this.saveSession(context, intent, request.query);

    const embedding = await this.provider.embedMany([request.query]);
    const candidates = await this.candidateRows(request, context, grant, intent, embedding.value[0]);
    const maxChars = Math.max(1_024, Math.min(80_000, request.limits.max_tokens * 4));
    const ranked = candidates.slice(0, request.limits.max_items);
    const memories = ranked.map((row) => responseMemory(row, maxChars));
    const requestId = randomUUID();
    let traceId: string = requestId;

    await withTransaction(this.pool, async (client) => {
      const trace = await client.query(
        `INSERT INTO agent_memory_recall_traces (
           request_id, workspace_id, project_id, session_id, agent_id, client_surface,
           runtime_name, runtime_version, task_id, flow_id, channel_kind, channel_id,
           intent_primary, intent_source, intent_confidence, query, schema_version,
           request_payload, response_policy
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb)
         RETURNING id`,
        [
          requestId,
          context.workspaceId,
          context.projectId || null,
          context.sessionId || null,
          context.agentId,
          context.clientSurface || null,
          context.runtimeName,
          context.runtimeVersion || null,
          context.taskId || null,
          context.flowId || null,
          context.channelKind || null,
          context.channelId || null,
          intent.primary,
          intent.source,
          intent.confidence,
          sanitizeDurableText(request.query, 6_000),
          request.schema_version,
          JSON.stringify(minimalTracePayload(request)),
          JSON.stringify({
            visibility: request.scope.visibility || "grant_allowed",
            mode: request.scope.mode || grant.defaultScopeMode,
            include_unconfirmed: request.scope.include_unconfirmed && grant.allowUnconfirmed,
            include_stale: request.scope.include_stale,
            embedding_provider: embedding.provider,
            embedding_model: embedding.model,
            embedding_dimensions: this.config.embeddingDimensions,
          }),
        ],
      );
      traceId = String(trace.rows[0].id);

      for (let index = 0; index < ranked.length; index += 1) {
        const row = ranked[index];
        await client.query(
          `INSERT INTO agent_memory_recall_items (
             trace_id, memory_id, rank, similarity, lexical_score, ranking_score, use_policy_snapshot
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            traceId,
            row.id,
            index + 1,
            number(row.similarity),
            number(row.lexical_score),
            number(row.ranking_score),
            JSON.stringify({
              can_use_as_instruction: bool(row.can_use_as_instruction),
              can_use_as_evidence: bool(row.can_use_as_evidence),
              requires_user_confirmation: bool(row.requires_user_confirmation),
              review_status: row.review_status || "pending",
            }),
          ],
        );
      }

      await client.query(
        `INSERT INTO agent_memory_audit_events (
           event_type, workspace_id, project_id, trace_id, actor_kind, actor_label,
           runtime_name, task_id, payload
         ) VALUES ('recall_requested', $1, $2, $3, 'agent', $4, $5, $6, $7::jsonb)`,
        [
          context.workspaceId,
          context.projectId || null,
          traceId,
          context.agentId,
          context.runtimeName,
          context.taskId || null,
          JSON.stringify({ returned_count: ranked.length, intent: intent.primary }),
        ],
      );
    });

    return {
      schema_version: responseSchemaFor(request.schema_version, "recall"),
      request_id: requestId,
      memories,
      intent: {
        primary: intent.primary,
        scores: intent.scores,
        confidence: intent.confidence,
        source: intent.source,
      },
      resolved_context: {
        workspace_id: context.workspaceId,
        project_id: context.projectId || null,
        session_id: context.sessionId || null,
        agent_id: context.agentId,
        client_surface: context.clientSurface || null,
        channel: {
          kind: context.channelKind || null,
          id: context.channelId || null,
          thread_id: context.channelThreadId || null,
        },
      },
      recall_policy: {
        semantic_embedding: `${embedding.provider}/${embedding.model}`,
        embedding_dimensions: this.config.embeddingDimensions,
        hybrid_search: true,
        project_isolation: true,
        generated_memory_instruction_safe: false,
      },
    };
  }

  async writeback(request: WritebackRequest, grant: ScopeGrant): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "writeback")) throw new Error("Scope grant does not allow writeback");
    const context = this.contextFor(request, grant);
    const visibility = visibilityForWriteback(request, context);
    if (!canUseVisibility(grant, visibility)) throw new Error(`Scope grant cannot write ${visibility} memories`);
    if (visibility === "project" && !context.projectId) throw new Error("Project-scoped memory requires project_id");
    if (visibility === "channel" && (!context.channelKind || !context.channelId)) throw new Error("Channel-scoped memory requires channel.kind and channel.id");

    const allCandidates = memoryCandidates(request.memory_payload);
    const skipped: Array<Record<string, unknown>> = [];
    const candidates = allCandidates.filter((candidate) => {
      const reasons = unsafeReasons(candidate.content);
      if (reasons.length) {
        skipped.push({ memory_type: candidate.memoryType, reason: "unsafe_writeback", reasons });
        return false;
      }
      return Boolean(candidate.content.trim());
    });

    const intentQuery = [request.task_type, ...candidates.slice(0, 3).map((candidate) => candidate.content)].filter(Boolean).join("\n").slice(0, 6_000) || "general memory writeback";
    const intent = await this.resolveIntent(context, intentQuery, request.intent_hint || request.model_intent.primary);
    await this.saveSession(context, intent, intentQuery);

    if (!candidates.length) {
      return {
        schema_version: responseSchemaFor(request.schema_version, "writeback"),
        memories: [],
        skipped,
        intent,
        resolved_context: { workspace_id: context.workspaceId, project_id: context.projectId || null, session_id: context.sessionId || null },
      };
    }

    const embedding = await this.provider.embedMany(candidates.map((candidate) => candidate.content));
    const model = providerModel(request);
    const created: Record<string, unknown>[] = [];
    const status = request.provenance.default_status;
    const canConfirm = hasScopeCapability(grant, "review");
    const instructionGrade = canConfirm && !request.provenance.requires_review && ["user_confirmed", "imported"].includes(status);
    const reviewStatus = instructionGrade ? "confirmed" : "pending";
    const requiresConfirmation = request.provenance.requires_review || !instructionGrade;
    const createdBy = actorKind(grant, request.provenance);
    const staleDate = staleAfter(request.retention.stale_after_days || request.retention.ttl_days);

    await withTransaction(this.pool, async (client) => {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const content = sanitizeDurableText(candidate.content, 15_000);
        const contentHash = sha256Hex(compactFingerprint(content));
        const idempotencyKey = request.idempotency_key
          ? `${request.idempotency_key}:${index + 1}:${candidate.memoryType}`
          : null;

        if (idempotencyKey) {
          const existing = await client.query("SELECT * FROM agent_memories WHERE idempotency_key = $1", [idempotencyKey]);
          if (existing.rows[0]) {
            created.push({ ...responseMemory(existing.rows[0]), deduplicated: true, deduplication_reason: "idempotency_key" });
            continue;
          }
        }

        const duplicate = await client.query(
          `SELECT * FROM agent_memories
           WHERE workspace_id = $1 AND content_hash = $2
             AND coalesce(project_id, '') = coalesce($3, '')
             AND visibility = $4
             AND lifecycle_status NOT IN ('rejected', 'superseded')
           ORDER BY created_at DESC LIMIT 1`,
          [context.workspaceId, contentHash, context.projectId || null, visibility],
        );
        if (duplicate.rows[0]) {
          created.push({ ...responseMemory(duplicate.rows[0]), deduplicated: true, deduplication_reason: "content_hash" });
          continue;
        }

        const metadata = {
          source: "agent_memory",
          source_type: "agent_memory",
          entities: request.memory_payload.entities,
          intent_primary: intent.primary,
          intent_source: intent.source,
          legacy_compatible: true,
          source_uri: request.source_refs[0]?.uri || null,
        };
        const thought = await client.query(
          `INSERT INTO thoughts (
             content, embedding, content_fingerprint, metadata, type, source_type,
             importance, quality_score, sensitivity_tier
           ) VALUES ($1, $2::halfvec(3072), $3, $4::jsonb, $5, 'agent_memory', $6, $7, 'standard')
           ON CONFLICT (content_fingerprint) DO UPDATE SET
             metadata = thoughts.metadata || EXCLUDED.metadata,
             updated_at = now()
           RETURNING id`,
          [
            content,
            vectorLiteral(embedding.value[index], this.config.embeddingDimensions),
            contentHash,
            JSON.stringify(metadata),
            memoryTypeToThoughtType(candidate.memoryType),
            candidate.memoryType === "decision" || candidate.memoryType === "constraint" ? 75 : 60,
            Math.min(100, Math.max(0, Math.round(request.provenance.confidence * 100))),
          ],
        );
        const thoughtId = String(thought.rows[0].id);
        const sidecar = await client.query(
          `INSERT INTO agent_memories (
             thought_id, workspace_id, project_id, session_id, agent_id, owner_id, client_surface,
             channel_kind, channel_id, channel_thread_id, visibility, memory_type,
             intent_primary, intent_scores, intent_source, intent_confidence,
             summary, content, provenance_status, confidence, created_by,
             runtime_name, runtime_version, provider, model, task_id, flow_id,
             can_use_as_instruction, can_use_as_evidence, requires_user_confirmation,
             review_status, last_confirmed_at, stale_after, idempotency_key, content_hash, metadata
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21,
             $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
             CASE WHEN $28 THEN now() ELSE NULL END, $32, $33, $34, $35::jsonb
           )
           RETURNING *`,
          [
            thoughtId,
            context.workspaceId,
            context.projectId || null,
            context.sessionId || null,
            context.agentId,
            context.agentId,
            context.clientSurface || null,
            context.channelKind || null,
            context.channelId || null,
            context.channelThreadId || null,
            visibility,
            candidate.memoryType,
            intent.primary,
            JSON.stringify(intent.scores),
            intent.source,
            intent.confidence,
            sanitizeDurableText(content.split(/\n|[.!?]\s/)[0], 240),
            content,
            status,
            request.provenance.confidence,
            createdBy,
            context.runtimeName,
            context.runtimeVersion || null,
            model.provider,
            model.model,
            context.taskId || null,
            context.flowId || null,
            instructionGrade,
            true,
            requiresConfirmation,
            reviewStatus,
            staleDate || null,
            idempotencyKey,
            contentHash,
            JSON.stringify(metadata),
          ],
        );
        const memory = sidecar.rows[0];

        for (const source of request.source_refs) {
          await client.query(
            `INSERT INTO agent_memory_source_refs (memory_id, source_kind, uri, title, source_timestamp)
             VALUES ($1, $2, $3, $4, $5)`,
            [memory.id, source.kind, source.uri || null, source.title || null, optionalDate(source.timestamp)?.toISOString() || null],
          );
        }
        if (candidate.artifact) {
          await client.query(
            `INSERT INTO agent_memory_artifacts (memory_id, artifact_kind, uri, description)
             VALUES ($1, $2, $3, $4)`,
            [memory.id, candidate.artifact.kind, candidate.artifact.uri, candidate.artifact.description || null],
          );
        }
        await client.query(
          `INSERT INTO agent_memory_audit_events (
             event_type, workspace_id, project_id, memory_id, actor_kind, actor_label,
             runtime_name, task_id, payload
           ) VALUES ('memory_written', $1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            context.workspaceId,
            context.projectId || null,
            memory.id,
            createdBy,
            context.agentId,
            context.runtimeName,
            context.taskId || null,
            JSON.stringify({ memory_type: candidate.memoryType, intent: intent.primary, review_status: reviewStatus }),
          ],
        );
        created.push(responseMemory(memory));
      }
    });

    return {
      schema_version: responseSchemaFor(request.schema_version, "writeback"),
      memories: created,
      skipped,
      intent: {
        primary: intent.primary,
        scores: intent.scores,
        confidence: intent.confidence,
        source: intent.source,
      },
      resolved_context: {
        workspace_id: context.workspaceId,
        project_id: context.projectId || null,
        session_id: context.sessionId || null,
        agent_id: context.agentId,
      },
      write_policy: {
        embedding_provider: embedding.provider,
        embedding_model: embedding.model,
        embedding_dimensions: this.config.embeddingDimensions,
        generated_memory_requires_review: true,
        instruction_grade_created: instructionGrade,
      },
    };
  }

  private async findMemoryRow(
    id: string,
    context: ResolvedContext,
    grant: ScopeGrant,
    options: { includeUnconfirmed?: boolean; includeStale?: boolean } = {},
  ): Promise<QueryResultRow | null> {
    const scope: ScopeRequest = {
      visibility: undefined,
      mode: "workspace",
      project_only: false,
      include_unconfirmed: false,
      include_stale: false,
      domain_mode: "rank",
      domain: undefined,
    };
    const filter = buildScopeFilter(context, grant, scope, 2, options);
    const result = await this.pool.query(
      `SELECT am.* FROM agent_memories am
       JOIN thoughts t ON t.id = am.thought_id
       WHERE am.id = $1 AND ${filter.sql}`,
      [id, ...filter.values],
    );
    return result.rows[0] || null;
  }

  private async enrichMemory(row: QueryResultRow): Promise<Record<string, unknown>> {
    const [sources, artifacts, relations] = await Promise.all([
      this.pool.query(
        `SELECT source_kind, uri, title, source_timestamp, metadata
         FROM agent_memory_source_refs WHERE memory_id = $1 ORDER BY created_at`,
        [row.id],
      ),
      this.pool.query(
        `SELECT artifact_kind, uri, description, metadata
         FROM agent_memory_artifacts WHERE memory_id = $1 ORDER BY created_at`,
        [row.id],
      ),
      this.pool.query(
        `SELECT from_memory_id, to_memory_id, relation, confidence, metadata
         FROM agent_memory_relations
         WHERE from_memory_id = $1 OR to_memory_id = $1
         ORDER BY created_at DESC`,
        [row.id],
      ),
    ]);
    return responseMemory({
      ...row,
      related_artifacts: artifacts.rows.map((artifact) => ({
        kind: artifact.artifact_kind,
        uri: artifact.uri,
        description: artifact.description || null,
        metadata: objectValue(artifact.metadata),
      })),
      source_refs: sources.rows.map((source) => ({
        kind: source.source_kind,
        uri: source.uri || null,
        title: source.title || null,
        timestamp: source.source_timestamp ? new Date(source.source_timestamp).toISOString() : null,
        metadata: objectValue(source.metadata),
      })),
      relations: relations.rows.map((relation) => ({
        from_memory_id: String(relation.from_memory_id),
        to_memory_id: String(relation.to_memory_id),
        relation: relation.relation,
        confidence: relation.confidence === null ? null : number(relation.confidence),
        metadata: objectValue(relation.metadata),
      })),
    }, 80_000);
  }

  async getMemory(id: string, context: ResolvedContext, grant: ScopeGrant): Promise<Record<string, unknown> | null> {
    if (!hasScopeCapability(grant, "recall")) throw new Error("Scope grant does not allow recall");
    const row = await this.findMemoryRow(id, context, grant, { includeUnconfirmed: true, includeStale: true });
    return row ? this.enrichMemory(row) : null;
  }

  async reportUsage(
    requestId: string,
    usage: RecallUsageRequest,
    grant: ScopeGrant,
  ): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "recall")) throw new Error("Scope grant does not allow recall");
    const traceResult = await this.pool.query(
      `SELECT id, request_id, workspace_id, project_id, runtime_name, task_id
       FROM agent_memory_recall_traces WHERE request_id = $1`,
      [requestId],
    );
    const trace = traceResult.rows[0];
    if (!trace) throw new Error("Recall trace not found");
    assertScopeGrantCanUse(grant, { workspaceId: String(trace.workspace_id), projectId: trace.project_id || undefined });

    const used: string[] = [];
    const ignored: Array<Record<string, unknown>> = [];
    await withTransaction(this.pool, async (client) => {
      for (const memoryId of usage.used_memory_ids) {
        const updated = await client.query(
          `UPDATE agent_memory_recall_items SET used = true
           WHERE trace_id = $1 AND memory_id = $2 RETURNING memory_id`,
          [trace.id, memoryId],
        );
        if (!updated.rows[0]) continue;
        used.push(String(memoryId));
        await client.query(
          `INSERT INTO agent_memory_audit_events (
             event_type, workspace_id, project_id, memory_id, trace_id, actor_kind,
             actor_label, runtime_name, task_id, payload
           ) VALUES ('memory_used', $1, $2, $3, $4, 'agent', $5, $6, $7, '{}'::jsonb)`,
          [trace.workspace_id, trace.project_id || null, memoryId, trace.id, grant.principalId, trace.runtime_name || null, trace.task_id || null],
        );
      }
      for (const entry of usage.ignored) {
        const updated = await client.query(
          `UPDATE agent_memory_recall_items SET used = false, ignored_reason = $3
           WHERE trace_id = $1 AND memory_id = $2 RETURNING memory_id`,
          [trace.id, entry.memory_id, entry.reason || null],
        );
        if (!updated.rows[0]) continue;
        const ignoredEntry = { memory_id: String(entry.memory_id), reason: entry.reason || null };
        ignored.push(ignoredEntry);
        await client.query(
          `INSERT INTO agent_memory_audit_events (
             event_type, workspace_id, project_id, memory_id, trace_id, actor_kind,
             actor_label, runtime_name, task_id, payload
           ) VALUES ('memory_ignored', $1, $2, $3, $4, 'agent', $5, $6, $7, $8::jsonb)`,
          [trace.workspace_id, trace.project_id || null, entry.memory_id, trace.id, grant.principalId, trace.runtime_name || null, trace.task_id || null, JSON.stringify({ reason: entry.reason || null })],
        );
      }
    });
    return { request_id: requestId, used_memory_ids: used, ignored };
  }

  async listReviewQueue(
    grant: ScopeGrant,
    workspaceId?: string,
    projectId?: string,
    limit = 100,
  ): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "review")) throw new Error("Scope grant does not allow review");
    const context = this.contextFor({
      workspace_id: workspaceId || grant.defaultWorkspaceId,
      project_id: projectId || grant.defaultProjectId || null,
      session_id: null,
      agent_id: grant.principalId,
      client_surface: "review",
      task_id: null,
      flow_id: null,
      channel: {},
      runtime: { name: "dashboard", version: null },
    }, grant);
    const scope: ScopeRequest = {
      visibility: undefined,
      mode: "workspace",
      project_only: false,
      include_unconfirmed: true,
      include_stale: true,
      domain_mode: "rank",
      domain: undefined,
    };
    const filter = buildScopeFilter(context, grant, scope, 1, { includeUnconfirmed: true, includeStale: true });
    const limitParam = `$${1 + filter.values.length}`;
    const result = await this.pool.query(
      `SELECT am.* FROM agent_memories am JOIN thoughts t ON t.id = am.thought_id
       WHERE am.review_status = 'pending' AND ${filter.sql}
       ORDER BY am.created_at DESC LIMIT ${limitParam}`,
      [...filter.values, Math.min(Math.max(limit, 1), 200)],
    );
    return {
      workspace_id: context.workspaceId,
      project_id: context.projectId || null,
      memories: await Promise.all(result.rows.map((row) => this.enrichMemory(row))),
      count: result.rows.length,
    };
  }

  async listMemories(
    grant: ScopeGrant,
    options: {
      workspaceId?: string;
      projectId?: string;
      reviewStatus?: string;
      lifecycleStatus?: string;
      runtimeName?: string;
      memoryType?: string;
      taskIdPrefix?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "recall")) throw new Error("Scope grant does not allow recall");
    const context = this.contextFor({
      workspace_id: options.workspaceId || grant.defaultWorkspaceId,
      project_id: options.projectId || grant.defaultProjectId || null,
      session_id: null,
      agent_id: grant.principalId,
      client_surface: "dashboard",
      task_id: null,
      flow_id: null,
      channel: {},
      runtime: { name: "dashboard", version: null },
    }, grant);
    const scope: ScopeRequest = {
      visibility: undefined,
      mode: "workspace",
      project_only: false,
      include_unconfirmed: true,
      include_stale: true,
      domain_mode: "rank",
      domain: undefined,
    };
    const filter = buildScopeFilter(context, grant, scope, 1, { includeUnconfirmed: true, includeStale: true });
    const clauses: string[] = [filter.sql];
    const values = [...filter.values];
    const add = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    if (options.reviewStatus) clauses.push(`am.review_status = ${add(options.reviewStatus)}`);
    if (options.lifecycleStatus) clauses.push(`am.lifecycle_status = ${add(options.lifecycleStatus)}`);
    if (options.runtimeName) clauses.push(`am.runtime_name = ${add(options.runtimeName)}`);
    if (options.memoryType) clauses.push(`am.memory_type = ${add(options.memoryType)}`);
    if (options.taskIdPrefix) clauses.push(`am.task_id LIKE ${add(`${options.taskIdPrefix}%`)}`);
    const limitParam = add(Math.min(Math.max(options.limit || 50, 1), 200));
    const offsetParam = add(Math.max(options.offset || 0, 0));
    const result = await this.pool.query(
      `SELECT am.*, count(*) OVER() AS total_count
       FROM agent_memories am JOIN thoughts t ON t.id = am.thought_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY am.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );
    return {
      workspace_id: context.workspaceId,
      project_id: context.projectId || null,
      memories: result.rows.map((row) => responseMemory(row)),
      count: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    };
  }

  async reviewMemory(
    id: string,
    request: ReviewRequest,
    context: ResolvedContext,
    grant: ScopeGrant,
  ): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "review")) throw new Error("Scope grant does not allow review");
    const before = await this.findMemoryRow(id, context, grant, { includeUnconfirmed: true, includeStale: true });
    if (!before) throw new Error("Memory not found or outside the authorized scope");

    let editedEmbedding: number[] | undefined;
    let editedProviderModel: { provider: string; model: string } | undefined;
    const editedContent = request.content ? sanitizeDurableText(request.content, 15_000) : undefined;
    if (request.action === "edit") {
      if (!editedContent && !request.summary) throw new Error("Edit requires content or summary");
      if (editedContent) {
        const reasons = unsafeReasons(editedContent);
        if (reasons.length) throw new Error(`Unsafe memory edit blocked: ${reasons.join(", ")}`);
        const embedding = await this.provider.embedMany([editedContent]);
        editedEmbedding = embedding.value[0];
        editedProviderModel = { provider: embedding.provider, model: embedding.model };
      }
    }
    if (request.action === "restrict_scope" && request.visibility) {
      if (!canUseVisibility(grant, request.visibility)) throw new Error("Scope grant cannot assign that visibility");
      if (request.visibility === "project" && !context.projectId) throw new Error("Project visibility requires project_id");
    }

    let related: QueryResultRow | null = null;
    if (["merge", "supersede"].includes(request.action)) {
      if (!request.related_memory_id) throw new Error(`${request.action} requires related_memory_id`);
      related = await this.findMemoryRow(request.related_memory_id, context, grant, { includeUnconfirmed: true, includeStale: true });
      if (!related) throw new Error("Related memory not found or outside the authorized scope");
      if (String(related.id) === id) throw new Error("A memory cannot be related to itself");
    }

    const after = await withTransaction(this.pool, async (client) => {
      if (request.action === "edit" && editedContent && before.thought_id) {
        const editedHash = sha256Hex(compactFingerprint(editedContent));
        await client.query(
          `UPDATE thoughts SET content = $2, embedding = $3::halfvec(3072), content_fingerprint = $4, updated_at = now()
           WHERE id = $1`,
          [before.thought_id, editedContent, vectorLiteral(editedEmbedding || [], this.config.embeddingDimensions), editedHash],
        );
        await client.query(
          `UPDATE agent_memories SET provider = $2, model = $3 WHERE id = $1`,
          [id, editedProviderModel?.provider || null, editedProviderModel?.model || null],
        );
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        updates.push(`${column} = $${values.length + 1}`);
      };
      if (request.summary) set("summary", request.summary);
      switch (request.action) {
        case "confirm":
          set("review_status", "confirmed");
          set("provenance_status", "user_confirmed");
          set("can_use_as_instruction", true);
          set("can_use_as_evidence", true);
          set("requires_user_confirmation", false);
          updates.push("last_confirmed_at = now()");
          break;
        case "edit":
          set("review_status", "confirmed");
          set("provenance_status", "user_confirmed");
          set("can_use_as_instruction", true);
          set("can_use_as_evidence", true);
          set("requires_user_confirmation", false);
          updates.push("last_confirmed_at = now()");
          if (editedContent) {
            set("content", editedContent);
            set("content_hash", sha256Hex(compactFingerprint(editedContent)));
          }
          break;
        case "evidence_only":
          set("review_status", "evidence_only");
          set("can_use_as_instruction", false);
          set("can_use_as_evidence", true);
          set("requires_user_confirmation", true);
          break;
        case "restrict_scope":
          set("review_status", "restricted");
          set("can_use_as_instruction", false);
          set("visibility", request.visibility || "personal");
          break;
        case "mark_stale":
          set("review_status", "stale");
          set("lifecycle_status", "stale");
          set("can_use_as_instruction", false);
          break;
        case "merge":
          set("review_status", "merged");
          set("lifecycle_status", "superseded");
          set("can_use_as_instruction", false);
          break;
        case "reject":
          set("review_status", "rejected");
          set("lifecycle_status", "rejected");
          set("can_use_as_instruction", false);
          set("can_use_as_evidence", false);
          break;
        case "dispute":
          set("review_status", "pending");
          set("lifecycle_status", "disputed");
          set("can_use_as_instruction", false);
          break;
        case "supersede":
          set("review_status", "stale");
          set("lifecycle_status", "superseded");
          set("can_use_as_instruction", false);
          break;
      }

      const updated = updates.length
        ? await client.query(`UPDATE agent_memories SET ${updates.join(", ")} WHERE id = $1 RETURNING *`, [id, ...values])
        : await client.query("SELECT * FROM agent_memories WHERE id = $1", [id]);
      const row = updated.rows[0];
      if (!row) throw new Error("Memory disappeared during review");

      if (related) {
        const relation = request.action === "merge" ? "merged_into" : "supersedes";
        await client.query(
          `INSERT INTO agent_memory_relations (from_memory_id, to_memory_id, relation, confidence)
           VALUES ($1, $2, $3, 1.0) ON CONFLICT (from_memory_id, to_memory_id, relation) DO NOTHING`,
          [id, related.id, relation],
        );
      }

      const beforeSnapshot = JSON.stringify({ id: before.id, review_status: before.review_status, lifecycle_status: before.lifecycle_status, visibility: before.visibility, summary: before.summary });
      const afterSnapshot = JSON.stringify({ id: row.id, review_status: row.review_status, lifecycle_status: row.lifecycle_status, visibility: row.visibility, summary: row.summary });
      await client.query(
        `INSERT INTO agent_memory_review_actions (memory_id, action, actor_id, actor_label, notes, before, after)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [id, request.action, request.actor_id || grant.principalId, request.actor_label || null, request.notes || null, beforeSnapshot, afterSnapshot],
      );
      const auditEvent: Record<string, string> = {
        confirm: "memory_confirmed",
        edit: "memory_edited",
        evidence_only: "memory_edited",
        restrict_scope: "memory_edited",
        mark_stale: "memory_edited",
        merge: "memory_superseded",
        reject: "memory_rejected",
        dispute: "memory_disputed",
        supersede: "memory_superseded",
      };
      await client.query(
        `INSERT INTO agent_memory_audit_events (
           event_type, workspace_id, project_id, memory_id, actor_kind, actor_label,
           runtime_name, task_id, payload
         ) VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, $8::jsonb)`,
        [auditEvent[request.action], context.workspaceId, context.projectId || null, id, request.actor_label || grant.principalId, context.runtimeName, context.taskId || null, JSON.stringify({ action: request.action })],
      );
      return row;
    });

    return { memory: await this.enrichMemory(after), action: request.action };
  }

  async getRecallTrace(requestId: string, grant: ScopeGrant): Promise<Record<string, unknown>> {
    if (!hasScopeCapability(grant, "recall")) throw new Error("Scope grant does not allow recall");
    const traceResult = await this.pool.query("SELECT * FROM agent_memory_recall_traces WHERE request_id = $1", [requestId]);
    const trace = traceResult.rows[0];
    if (!trace) throw new Error("Recall trace not found");
    assertScopeGrantCanUse(grant, { workspaceId: String(trace.workspace_id), projectId: trace.project_id || undefined });
    const items = await this.pool.query(
      `SELECT ri.id AS recall_item_id, ri.trace_id AS recall_trace_id, ri.memory_id AS recall_memory_id,
              ri.rank AS recall_rank, ri.similarity AS recall_similarity,
              ri.lexical_score AS recall_lexical_score, ri.ranking_score AS recall_ranking_score,
              ri.returned AS recall_returned, ri.used AS recall_used,
              ri.ignored_reason AS recall_ignored_reason,
              ri.use_policy_snapshot AS recall_use_policy_snapshot,
              ri.created_at AS recall_created_at,
              am.*
       FROM agent_memory_recall_items ri
       JOIN agent_memories am ON am.id = ri.memory_id
       WHERE ri.trace_id = $1 ORDER BY ri.rank`,
      [trace.id],
    );
    return {
      trace: {
        ...trace,
        id: String(trace.id),
        request_id: String(trace.request_id),
        query: sanitizeDurableText(String(trace.query || ""), 6_000),
      },
      items: items.rows.map((row) => {
        const memory = responseMemory(row, 20_000);
        return {
          id: String(row.recall_item_id),
          trace_id: String(row.recall_trace_id),
          memory_id: String(row.recall_memory_id),
          rank: row.recall_rank,
          similarity: row.recall_similarity === null ? null : number(row.recall_similarity),
          lexical_score: row.recall_lexical_score === null ? null : number(row.recall_lexical_score),
          ranking_score: row.recall_ranking_score === null ? null : number(row.recall_ranking_score),
          returned: row.recall_returned,
          used: row.recall_used,
          ignored_reason: row.recall_ignored_reason || null,
          use_policy_snapshot: objectValue(row.recall_use_policy_snapshot),
          created_at: row.recall_created_at,
          memory,
          agent_memories: memory,
        };
      }),
    };
  }
}
