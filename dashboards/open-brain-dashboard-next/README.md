# OB1 Operator Dashboard

This is the active Next.js dashboard for the native OCI API. It provides
authenticated browsing, search, capture, ingestion, workflow, audit,
duplicate review, and Agent Memory governance views.

## Production source

- API source: [integrations/oci-node/](../../integrations/oci-node/)
- API URL: http://127.0.0.1:8787 on the OCI host
- Dashboard service: [ob1-dashboard.service](../../integrations/oci-node/systemd/ob1-dashboard.service)
- Agent Memory operations: [OCI scope guide](../../docs/agent-memory-oci-scopes.md)

## Configuration

The service reads dashboard.env from /etc/ob1. Local development can use a
dashboard-local environment file:

    NEXT_PUBLIC_API_URL=http://127.0.0.1:8787
    SESSION_SECRET=replace-with-at-least-32-characters
    AGENT_MEMORY_API_URL=http://127.0.0.1:8787/agent-memory
    AGENT_MEMORY_WORKSPACE_ID=default
    AGENT_MEMORY_PROJECT_ID=ob1
    AUTH_COOKIE_SECURE=true
    RESTRICTED_PASSPHRASE_HASH=optional-sha256-value

The API key is entered at login and held in an encrypted server-side session.
Do not place API keys in this repository or in NEXT_PUBLIC variables.

## Local development

    cd dashboards/open-brain-dashboard-next
    npm install
    npm run dev

Open http://127.0.0.1:3000. The API must be reachable at the configured
NEXT_PUBLIC_API_URL.

## Production build

    npm ci
    npm run lint
    npm run build

The build uses standalone output. The OCI service starts
.next/standalone/server.js with Node 24. Install or restart the service only
after the build succeeds.

## Database contract

The active OCI schema is applied in order by the API migration command:

- [001_initial.sql](../../integrations/oci-node/migrations/001_initial.sql)
- [002_agent_memory_scope.sql](../../integrations/oci-node/migrations/002_agent_memory_scope.sql)

The workflow board, ingestion screens, and Agent Memory views depend on the
tables and routes created by those migrations. Use additive migrations only.

## Active surfaces

- Dashboard: counts, recent activity, and workflow summary
- Thoughts: filtered browse and detail editing
- Workflow: task and idea status board
- Search: semantic and text search
- Add to Brain: capture and document ingestion
- Audit and duplicates: quality review and resolution
- Agent Memory: review queue, memory inspection, and recall traces

## API routes used

The dashboard calls the OCI API for health, thoughts, stats, search, capture,
ingestion jobs, duplicates, reflections, and Agent Memory routes under
/agent-memory. The service contract is implemented in
[integrations/oci-node/src/app.ts](../../integrations/oci-node/src/app.ts).

## Troubleshooting

- Login cannot reach the API: verify the API unit is running and
  NEXT_PUBLIC_API_URL points to port 8787.
- Sessions fail: provide a SESSION_SECRET of at least 32 characters and set
  AUTH_COOKIE_SECURE only when serving HTTPS.
- Search is empty: confirm the database has populated embeddings and that the
  API doctor command passes.
- Ingestion is stuck: inspect the ob1-api journal and verify the PostgreSQL
  migration completed.
- Agent Memory is unavailable: verify AGENT_MEMORY_API_URL and the scope grant
  configuration described in the OCI scope guide.

Keep generated .next, node_modules, and local environment files ignored.
