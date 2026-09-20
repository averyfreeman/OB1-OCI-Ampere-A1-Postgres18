-- OCI-native Agent Memory sidecar.
--
-- `thoughts` remains the canonical content + embedding table. These tables add
-- runtime-neutral scope, provenance, review, intent, and recall-trace metadata
-- without changing the immutable text-embedding-3-large/3072 contract.

CREATE TABLE IF NOT EXISTS agent_memory_sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  agent_id TEXT,
  runtime_name TEXT,
  runtime_version TEXT,
  client_surface TEXT,
  channel_kind TEXT,
  channel_id TEXT,
  channel_thread_id TEXT,
  active_domain TEXT CHECK (active_domain IN ('code', 'research', 'personal', 'operations', 'general', 'unknown')),
  domain_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  domain_source TEXT,
  domain_confidence NUMERIC(4,3),
  last_query_hash TEXT,
  last_activity TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_sessions_scope
  ON agent_memory_sessions (workspace_id, project_id, last_activity DESC);

CREATE TABLE IF NOT EXISTS agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id UUID REFERENCES thoughts(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  agent_id TEXT,
  owner_id TEXT,
  client_surface TEXT,
  channel_kind TEXT,
  channel_id TEXT,
  channel_thread_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'project' CHECK (
    visibility IN ('personal', 'channel', 'project', 'workspace', 'organization')
  ),
  memory_type TEXT NOT NULL CHECK (
    memory_type IN (
      'decision',
      'output',
      'lesson',
      'constraint',
      'open_question',
      'failure',
      'artifact_reference',
      'work_log'
    )
  ),
  intent_primary TEXT NOT NULL DEFAULT 'unknown' CHECK (
    intent_primary IN ('code', 'research', 'personal', 'operations', 'general', 'unknown')
  ),
  intent_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  intent_source TEXT,
  intent_confidence NUMERIC(4,3) CHECK (intent_confidence IS NULL OR (intent_confidence >= 0 AND intent_confidence <= 1)),
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (
    lifecycle_status IN ('active', 'stale', 'superseded', 'disputed', 'rejected')
  ),
  provenance_status TEXT NOT NULL DEFAULT 'generated' CHECK (
    provenance_status IN ('observed', 'inferred', 'user_confirmed', 'imported', 'generated', 'superseded', 'disputed')
  ),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  created_by TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('user', 'agent', 'system', 'import')),
  runtime_name TEXT,
  runtime_version TEXT,
  provider TEXT,
  model TEXT,
  task_id TEXT,
  flow_id TEXT,
  can_use_as_instruction BOOLEAN NOT NULL DEFAULT false,
  can_use_as_evidence BOOLEAN NOT NULL DEFAULT true,
  requires_user_confirmation BOOLEAN NOT NULL DEFAULT true,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'confirmed', 'evidence_only', 'restricted', 'rejected', 'stale', 'merged')
  ),
  last_confirmed_at TIMESTAMPTZ,
  stale_after TIMESTAMPTZ,
  idempotency_key TEXT,
  content_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (can_use_as_instruction = false OR provenance_status IN ('user_confirmed', 'imported'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_idempotency_key
  ON agent_memories (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_memories_scope
  ON agent_memories (workspace_id, project_id, visibility, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_agent_memories_context
  ON agent_memories (workspace_id, session_id, channel_kind, channel_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_intent
  ON agent_memories (workspace_id, intent_primary, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_review
  ON agent_memories (workspace_id, review_status, lifecycle_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_runtime_task
  ON agent_memories (runtime_name, task_id, flow_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_content_hash
  ON agent_memories (workspace_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_memory_source_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  uri TEXT,
  title TEXT,
  source_timestamp TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_source_refs_memory
  ON agent_memory_source_refs (memory_id);

CREATE TABLE IF NOT EXISTS agent_memory_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_artifacts_memory
  ON agent_memory_artifacts (memory_id);

CREATE TABLE IF NOT EXISTS agent_memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  to_memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('related_to', 'supersedes', 'superseded_by', 'conflicts_with', 'merged_into')),
  confidence NUMERIC(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_memory_id, to_memory_id, relation),
  CHECK (from_memory_id <> to_memory_id)
);

CREATE TABLE IF NOT EXISTS agent_memory_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('confirm', 'edit', 'evidence_only', 'restrict_scope', 'mark_stale', 'merge', 'reject', 'dispute', 'supersede')),
  actor_id TEXT,
  actor_label TEXT,
  notes TEXT,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_review_actions_memory
  ON agent_memory_review_actions (memory_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory_recall_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  agent_id TEXT,
  client_surface TEXT,
  runtime_name TEXT,
  runtime_version TEXT,
  task_id TEXT,
  flow_id TEXT,
  channel_kind TEXT,
  channel_id TEXT,
  intent_primary TEXT,
  intent_source TEXT,
  intent_confidence NUMERIC(4,3),
  query TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_recall_traces_scope
  ON agent_memory_recall_traces (workspace_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory_recall_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL REFERENCES agent_memory_recall_traces(id) ON DELETE CASCADE,
  memory_id UUID NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  similarity NUMERIC(7,5),
  lexical_score NUMERIC(7,5),
  ranking_score NUMERIC(7,5),
  returned BOOLEAN NOT NULL DEFAULT true,
  used BOOLEAN,
  ignored_reason TEXT,
  use_policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trace_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_recall_items_trace
  ON agent_memory_recall_items (trace_id, rank);

CREATE TABLE IF NOT EXISTS agent_memory_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'recall_requested', 'memory_returned', 'memory_used', 'memory_ignored',
    'memory_written', 'memory_confirmed', 'memory_edited', 'memory_rejected',
    'memory_superseded', 'memory_disputed'
  )),
  workspace_id TEXT,
  project_id TEXT,
  memory_id UUID REFERENCES agent_memories(id) ON DELETE SET NULL,
  trace_id UUID REFERENCES agent_memory_recall_traces(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('user', 'agent', 'system', 'import')),
  actor_label TEXT,
  runtime_name TEXT,
  task_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_audit_scope
  ON agent_memory_audit_events (workspace_id, project_id, created_at DESC);

CREATE OR REPLACE FUNCTION agent_memory_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_memories_updated_at ON agent_memories;
CREATE TRIGGER agent_memories_updated_at
  BEFORE UPDATE ON agent_memories
  FOR EACH ROW EXECUTE FUNCTION agent_memory_set_updated_at();

DROP TRIGGER IF EXISTS agent_memory_sessions_updated_at ON agent_memory_sessions;
CREATE TRIGGER agent_memory_sessions_updated_at
  BEFORE UPDATE ON agent_memory_sessions
  FOR EACH ROW EXECUTE FUNCTION agent_memory_set_updated_at();

-- Make existing OB1 thoughts visible to the new scoped API. They are imported
-- evidence and remain pending until a human reviews them; this does not make
-- legacy content instruction-grade.
INSERT INTO agent_memories (
  thought_id,
  workspace_id,
  visibility,
  memory_type,
  intent_primary,
  summary,
  content,
  provenance_status,
  confidence,
  created_by,
  can_use_as_instruction,
  can_use_as_evidence,
  requires_user_confirmation,
  review_status,
  content_hash,
  metadata,
  created_at,
  updated_at
)
SELECT
  t.id,
  'default',
  'workspace',
  CASE
    WHEN t.type IN ('decision', 'lesson', 'task', 'idea', 'reference', 'person_note', 'meeting', 'journal', 'observation')
      THEN CASE t.type
        WHEN 'decision' THEN 'decision'
        WHEN 'lesson' THEN 'lesson'
        WHEN 'reference' THEN 'output'
        WHEN 'task' THEN 'constraint'
        ELSE 'work_log'
      END
    ELSE 'work_log'
  END,
  'unknown',
  left(regexp_replace(t.content, '\s+', ' ', 'g'), 240),
  t.content,
  'imported',
  0.50,
  'import',
  false,
  true,
  true,
  'pending',
  t.content_fingerprint,
  jsonb_build_object('legacy_import', true, 'legacy_source_type', t.source_type) || coalesce(t.metadata, '{}'::jsonb),
  t.created_at,
  t.updated_at
FROM thoughts t
WHERE NOT EXISTS (
  SELECT 1 FROM agent_memories am WHERE am.thought_id = t.id
);

