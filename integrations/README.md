# Active integration

This checkout keeps the native OCI integration because it is the source for the
running API and ingestion service.

| Integration | Purpose |
| --- | --- |
| [oci-node/](oci-node/) | Node 24 API, PostgreSQL migrations, ingestion, Agent Memory routes, tests, and systemd units |

The other integration experiments and client adapters are preserved under
BACKUP_RESOURCES/integrations/ and ignored by default. Restore one explicitly
before using it.
