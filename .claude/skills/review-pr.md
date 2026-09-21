# Review OB1 production changes

Review the active OCI API, dashboard, Pages landing page, and maintenance
automation as a production system. Historical and optional resources are
archived under BACKUP_RESOURCES/ and are not part of the default review
surface.

## Review order

1. Check git status --short and the exact diff.
2. Confirm the change stays within the active repository map.
3. Prioritize security regressions, broken service paths, data-loss risks,
   authentication failures, migration incompatibilities, and API contract
   changes.
4. Check that generated or inferred memory remains reviewable evidence.
5. Verify tests and build checks match the changed subsystem.

## Runtime checks

- OCI changes preserve the systemd working directory, environment-file
  contract, ports, and migration ordering.
- Dashboard changes preserve API-key handling, encrypted sessions, and the
  NEXT_PUBLIC_API_URL contract.
- Pages changes preserve CNAME, crawler files, and the workflow artifact path.
- Documentation changes do not point to archived paths unless they explicitly
  describe recovery.

## Security checks

- No secrets, tokens, private URLs, or credentials are introduced.
- No raw transcripts, model reasoning traces, or large code blocks are stored.
- Scope, provenance, review, and audit policy remain enforced.
- SQL is additive and qualified; no destructive database operations are added.

## Handoff

Report findings by severity with file and line references. Include the exact
verification commands and state whether the active deployment paths remain
unchanged.
