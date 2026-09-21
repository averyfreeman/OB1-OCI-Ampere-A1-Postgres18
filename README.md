# OB1 — OCI Production Surface

<p align="center">
  <img src=".github/ob1-logo-wide.png" alt="Open Brain" width="600">
</p>

Open Brain is a durable memory service for AI clients. This checkout is the
small production surface for the native OCI deployment: one PostgreSQL-backed
API, one operator dashboard, and the public landing page.

OB1 was created by [Nate B. Jones](https://natebjones.com/). Practical systems
and the broader project context are available through
[Nate's newsletter](https://substack.com/@natesnewsletter).

## Active deployment

| Surface | Source | Runtime |
| --- | --- | --- |
| API and ingestion | [integrations/oci-node/](integrations/oci-node/) | ob1-api, port 8787 |
| Operator dashboard | [dashboards/open-brain-dashboard-next/](dashboards/open-brain-dashboard-next/) | ob1-dashboard, port 3000 |
| Public landing page | [dashboards/ob1-canonical-landing/](dashboards/ob1-canonical-landing/) | GitHub Pages via [deploy-pages.yml](.github/workflows/deploy-pages.yml) |

The systemd units are the deployment source of truth:

- [ob1-api.service](integrations/oci-node/systemd/ob1-api.service)
- [ob1-dashboard.service](integrations/oci-node/systemd/ob1-dashboard.service)

## Local verification

    cd integrations/oci-node
    /usr/bin/npm-24 install
    /usr/bin/npm-24 test
    /usr/bin/npm-24 run build

    cd ../../dashboards/open-brain-dashboard-next
    npm install
    npm run lint
    npm run build

Follow [integrations/oci-node/README.md](integrations/oci-node/README.md)
for PostgreSQL, environment files, migrations, service installation, and
network-boundary requirements.

## Operational references

- [OCI Agent Memory scopes](docs/agent-memory-oci-scopes.md)
- [Agent Memory portability contract](docs/agent-memory-portability.md)
- [Safe provenance and review policy](docs/safe-agent-memory-provenance.md)
- [Ingestion metadata contract](docs/ingestion-metadata-contract.md)
- [Security policy](SECURITY.md)

## Repository surface policy

Only files required by the OCI runtime, the configured Pages deployment, or
ongoing maintenance are tracked in the active tree. Historical, optional, and
alternate resources are preserved locally under BACKUP_RESOURCES/.

BACKUP_RESOURCES/.gitignore ignores backup contents by default. To intentionally
version one recovered resource:

    git add -f BACKUP_RESOURCES/<path>

Do not place credentials, API keys, private environment files, raw transcripts,
model reasoning traces, or large code blocks in the repository.

## License

[FSL-1.1-MIT](LICENSE.md)
