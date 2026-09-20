-- OCI-native OB1 schema.
-- The embedding contract is deliberately separate from the legacy Supabase
-- schemas: this database starts clean and uses text-embedding-3-large/3072.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embedding_contract (
  contract_key TEXT PRIMARY KEY CHECK (contract_key = 'default'),
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  storage_type TEXT NOT NULL,
  distance_metric TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO embedding_contract (
  contract_key, model_id, dimensions, storage_type, distance_metric
)
VALUES ('default', 'text-embedding-3-large', 3072, 'halfvec', 'cosine')
ON CONFLICT (contract_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS thoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding halfvec(3072) NOT NULL,
  content_fingerprint TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  type TEXT NOT NULL DEFAULT 'observation',
  source_type TEXT NOT NULL DEFAULT 'unknown',
  importance SMALLINT NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  quality_score NUMERIC(5,2) NOT NULL DEFAULT 70 CHECK (quality_score BETWEEN 0 AND 100),
  sensitivity_tier TEXT NOT NULL DEFAULT 'standard',
  status TEXT,
  status_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_updated_at ON thoughts (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_type ON thoughts (type);
CREATE INDEX IF NOT EXISTS idx_thoughts_source_type ON thoughts (source_type);
CREATE INDEX IF NOT EXISTS idx_thoughts_status ON thoughts (status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_thoughts_content_tsv ON thoughts USING gin (
  to_tsvector('simple', coalesce(content, ''))
);
CREATE INDEX IF NOT EXISTS idx_thoughts_embedding_hnsw ON thoughts
  USING hnsw (embedding halfvec_cosine_ops);

CREATE OR REPLACE FUNCTION set_thought_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS thoughts_updated_at ON thoughts;
CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW EXECUTE FUNCTION set_thought_updated_at();

CREATE TABLE IF NOT EXISTS ingested_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  extractor TEXT,
  extracted_count INTEGER NOT NULL DEFAULT 0,
  generated_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingested_files_status ON ingested_files (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingested_files_sha256_active
  ON ingested_files (sha256) WHERE status <> 'deleted';

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES ingested_files(id) ON DELETE SET NULL,
  source_label TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'text',
  input_hash TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  extracted_count INTEGER NOT NULL DEFAULT 0,
  added_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  appended_count INTEGER NOT NULL DEFAULT 0,
  revised_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_queue
  ON ingestion_jobs (created_at) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_file ON ingestion_jobs (file_id);

CREATE TABLE IF NOT EXISTS ingestion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  result_thought_id UUID REFERENCES thoughts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_items_job ON ingestion_items (job_id, created_at);

CREATE TABLE IF NOT EXISTS thought_sources (
  thought_id UUID NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES ingested_files(id) ON DELETE CASCADE,
  locator_hash TEXT NOT NULL,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_method TEXT NOT NULL,
  generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (thought_id, file_id, locator_hash)
);

CREATE INDEX IF NOT EXISTS idx_thought_sources_file ON thought_sources (file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_thought_sources_thought ON thought_sources (thought_id, created_at);

CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id UUID NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  trigger_context TEXT NOT NULL DEFAULT '',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  conclusion TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.75 CHECK (confidence BETWEEN 0 AND 1),
  reflection_type TEXT NOT NULL DEFAULT 'reflection',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reflections_thought ON reflections (thought_id, created_at DESC);

CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding halfvec(3072),
  match_threshold FLOAT DEFAULT 0.35,
  match_count INT DEFAULT 25,
  exclude_restricted BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    t.id, t.content, t.metadata, t.type, t.source_type,
    t.importance, t.quality_score, t.sensitivity_tier,
    t.created_at, t.updated_at,
    (1 - (t.embedding <=> query_embedding))::FLOAT AS similarity
  FROM thoughts t
  WHERE (NOT exclude_restricted OR t.sensitivity_tier <> 'restricted')
    AND (1 - (t.embedding <=> query_embedding)) >= match_threshold
  ORDER BY t.embedding <=> query_embedding
  LIMIT greatest(1, least(match_count, 100));
$$;

CREATE OR REPLACE FUNCTION search_thoughts_text(
  p_query TEXT,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0,
  p_exclude_restricted BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  type TEXT,
  source_type TEXT,
  importance SMALLINT,
  quality_score NUMERIC(5,2),
  sensitivity_tier TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  rank REAL,
  total_count BIGINT
)
LANGUAGE SQL STABLE AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('simple', trim(p_query)) AS query
  ), hits AS (
    SELECT
      t.id, t.content, t.metadata, t.type, t.source_type,
      t.importance, t.quality_score, t.sensitivity_tier,
      t.created_at, t.updated_at,
      ts_rank_cd(to_tsvector('simple', coalesce(t.content, '')), q.query)::REAL AS rank
    FROM thoughts t CROSS JOIN q
    WHERE trim(p_query) <> ''
      AND to_tsvector('simple', coalesce(t.content, '')) @@ q.query
      AND (NOT p_exclude_restricted OR t.sensitivity_tier <> 'restricted')
  )
  SELECT h.*, count(*) OVER () AS total_count
  FROM hits h
  ORDER BY h.rank DESC, h.created_at DESC
  LIMIT greatest(1, least(p_limit, 100))
  OFFSET greatest(0, p_offset);
$$;

CREATE OR REPLACE FUNCTION brain_stats_aggregate(
  p_since_days INTEGER DEFAULT 0,
  p_exclude_restricted BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE SQL STABLE AS $$
  SELECT jsonb_build_object(
    'total', (
      SELECT count(*) FROM thoughts
      WHERE NOT p_exclude_restricted OR sensitivity_tier <> 'restricted'
    ),
    'top_types', coalesce((
      SELECT jsonb_agg(jsonb_build_object('type', type, 'count', count))
      FROM (
        SELECT type, count(*) FROM thoughts
        WHERE (p_since_days <= 0 OR created_at >= now() - make_interval(days => p_since_days))
          AND (NOT p_exclude_restricted OR sensitivity_tier <> 'restricted')
        GROUP BY type ORDER BY count(*) DESC LIMIT 20
      ) types
    ), '[]'::jsonb),
    'top_topics', coalesce((
      SELECT jsonb_agg(jsonb_build_object('topic', topic, 'count', count))
      FROM (
        SELECT topic, count(*)
        FROM thoughts, jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(metadata->'topics') = 'array' THEN metadata->'topics' ELSE '[]'::jsonb END
        ) topic
        WHERE (p_since_days <= 0 OR thoughts.created_at >= now() - make_interval(days => p_since_days))
          AND (NOT p_exclude_restricted OR sensitivity_tier <> 'restricted')
        GROUP BY topic ORDER BY count(*) DESC LIMIT 20
      ) topics
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION get_thought_connections(
  p_thought_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_exclude_restricted BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  importance SMALLINT,
  preview TEXT,
  created_at TIMESTAMPTZ,
  shared_topics TEXT[],
  shared_people TEXT[],
  overlap_count INTEGER
)
LANGUAGE SQL STABLE AS $$
  WITH source AS (
    SELECT
      ARRAY(SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(metadata->'topics') = 'array' THEN metadata->'topics' ELSE '[]'::jsonb END
      )) AS topics,
      ARRAY(SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(metadata->'people') = 'array' THEN metadata->'people' ELSE '[]'::jsonb END
      )) AS people
    FROM thoughts WHERE id = p_thought_id
  ), candidates AS (
    SELECT
      t.id, t.type, t.importance, left(t.content, 200) AS preview, t.created_at,
      ARRAY(SELECT value FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(t.metadata->'topics') = 'array' THEN t.metadata->'topics' ELSE '[]'::jsonb END
      ) WHERE value = ANY(source.topics)) AS shared_topics,
      ARRAY(SELECT value FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(t.metadata->'people') = 'array' THEN t.metadata->'people' ELSE '[]'::jsonb END
      ) WHERE value = ANY(source.people)) AS shared_people
    FROM thoughts t CROSS JOIN source
    WHERE t.id <> p_thought_id
      AND (NOT p_exclude_restricted OR t.sensitivity_tier <> 'restricted')
  )
  SELECT c.id, c.type, c.importance, c.preview, c.created_at,
    c.shared_topics, c.shared_people,
    (coalesce(array_length(c.shared_topics, 1), 0) + coalesce(array_length(c.shared_people, 1), 0))::INTEGER
  FROM candidates c
  WHERE cardinality(c.shared_topics) + cardinality(c.shared_people) > 0
  ORDER BY 8 DESC, c.created_at DESC
  LIMIT greatest(1, least(p_limit, 50));
$$;
