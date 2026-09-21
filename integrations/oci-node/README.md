# OB1 OCI Node deployment

This is the native Node 24 runtime for the OCI ARM instance and the active API
source for this checkout. Alternate runtimes and integrations are preserved
under BACKUP_RESOURCES/integrations/ and are not tracked by default.

## Contracts

- API: `8787`; dashboard: `3000`; legacy MCP: `/mcp`; scoped MCP:
  `/agent-memory/mcp`.
- Primary overlay: `100.113.183.43`; ZeroTier fallback: `192.168.0.30`.
- Embeddings: OpenAI `text-embedding-3-large`, exactly 3072 dimensions.
- Database storage: pgvector `halfvec(3072)` with cosine HNSW indexing.
- Inference: `gpt-5.6-luna` with reasoning `max`; OpenAI direct first,
  OpenRouter exact-model fallback.
- `AGENT_MEMORY_API_URL` is not an inference URL. For this native deployment,
  set it to `http://<tailnet-host>:8787/agent-memory` (or the equivalent
  HTTPS URL). The inference provider is selected internally from the OpenAI
  and OpenRouter keys.

## Harness scoping

The API uses one compatibility admin key (`OB1_BRAIN_KEY`) plus optional
least-privilege grants in `OB1_SCOPE_GRANTS_JSON`. A grant can restrict
workspaces, projects, visibility levels, and capabilities (`recall`,
`writeback`, `review`, `admin`). Requests carry `workspace_id`, `project_id`,
`session_id`, `agent_id`, channel, runtime, and client-surface context.

The server filters scope before vector/lexical ranking. Model-assisted intent
classification (`code`, `research`, `personal`, `operations`, or `general`)
only changes ranking and session continuity; it never grants access. Generated
write-backs remain evidence pending human review, while imported or confirmed
instruction-grade memory requires the `review` capability.

The scoped REST routes are available below `/agent-memory` and at root aliases
for existing adapters:

| Capability | Scoped route |
| --- | --- |
| Recall | `POST /agent-memory/recall` |
| Write-back | `POST /agent-memory/writeback` |
| Usage | `POST /agent-memory/recall/:request_id/usage` |
| Review queue | `GET /agent-memory/memories/review` |
| Review | `PATCH /agent-memory/memories/:id/review` |
| Trace | `GET /agent-memory/recall-traces/:request_id` |
| MCP | `POST /agent-memory/mcp` |

All scoped routes accept either `x-brain-key` or `Authorization: Bearer
<grant-secret>`. Keep the service on Tailscale/ZeroTier for internal use; a
hosted ChatGPT connector needs a stable HTTPS endpoint and an appropriate
OAuth or bearer-auth front door.

## Local checks

```bash
/usr/bin/npm-24 install
/usr/bin/npm-24 test
/usr/bin/npm-24 run build
```

## Privileged OCI setup

Run these from a normal SSH session. The Codex sandbox cannot use systemd or
sudo because it has no-new-privileges enabled.

1. Install the PDF/SVG utilities and ensure exactly one PostgreSQL 18 systemd
   unit owns the cluster:

```bash
sudo dnf install -y poppler-utils librsvg2-tools
systemctl list-unit-files 'postgresql*'
```

Enable the installed PostgreSQL 18 unit, keep PostgreSQL bound to loopback,
and create the clean `ob1` database plus `ob1_app` role. Do not open 5432 in
OCI ingress.

1. Create `/etc/ob1/ob1.env` from `.env.example`, adding the supplied API keys
   and a newly generated `OB1_BRAIN_KEY`. Keep it mode `0600`, owned by
   `avery:avery`.

1. Create `/etc/ob1/dashboard.env` with `NEXT_PUBLIC_API_URL` set to the
   Tailscale URL, `SESSION_SECRET` set to a 32+ character value, and
   `NEXT_PUBLIC_AGENT_MEMORY_ENABLED=false`.

1. Apply the schema and verify the provider/embedding contract:

```bash
cd /home/avery/OB1/integrations/oci-node
/usr/bin/npm-24 run migrate
/usr/bin/npm-24 run doctor
```

The migration also imports existing `thoughts` into the `default` workspace as
pending, imported evidence. If `OB1_DEFAULT_WORKSPACE_ID` is changed to a new
workspace, explicitly migrate or re-import those records before using that
workspace.

1. Build the dashboard with the dashboard environment loaded, install the
   two unit files, then enable `ob1-api` and `ob1-dashboard`.

Retained originals live outside the repository at `/var/lib/ob1/uploads`,
with a 25 MiB per-file and 2 GiB aggregate quota. The API is intended to be
reachable only over Tailscale/ZeroTier; add OCI ingress rules only when an
ad-hoc external test is explicitly needed.
