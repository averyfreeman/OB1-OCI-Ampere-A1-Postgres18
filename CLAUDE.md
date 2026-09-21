# OB1 Agent Instructions

This checkout is the reduced production surface for the native OCI deployment
and its configured GitHub Pages landing page.

## Active repository map

    integrations/oci-node/                  OCI API, ingestion, migrations, tests
    dashboards/open-brain-dashboard-next/  active operator dashboard
    dashboards/ob1-canonical-landing/      active static Pages site
    docs/                                   operational contracts and runbooks
    .github/                                CI, deployment, review, and security automation

Historical, optional, and alternate resources live under
BACKUP_RESOURCES/ and are ignored by default.

## Worktrees

Use one Git worktree per active agent or PR-sized task. Treat /home/avery/OB1
as the canonical checkout for inspection and worktree creation. Do not edit
sibling worktrees. Before staging, run git status --short and stage only files
belonging to the current task.

## Production guardrails

- Keep the OCI API and dashboard paths used by the systemd units unchanged.
- Do not commit credentials, API keys, tokens, private environment files, raw
  transcripts, model reasoning traces, or large code blocks.
- Do not alter or drop existing database tables. Additive migrations only.
- Keep inferred or generated memory as evidence until human confirmation or a
  trusted import promotes it.
- Keep memory entries compact and preserve provenance, scope, review state, and
  auditability.
- Avoid profanity in documentation, examples, UI copy, prompts, and generated
  assets.
- Keep Nate B. Jones / OB1 provenance subtle and useful in public surfaces.

## Validation

For OCI runtime changes:

    cd integrations/oci-node
    /usr/bin/npm-24 test
    /usr/bin/npm-24 run build

For dashboard changes:

    cd dashboards/open-brain-dashboard-next
    npm run lint
    npm run build

Run the committed gate helper tests before handoff:

    node --test .github/scripts/gate-context.test.cjs
    python3 -B .github/scripts/test_gate_artifact.py

The root LICENSE.md, SECURITY.md, CONTRIBUTING.md, and this file remain
tracked because they govern legal distribution and ongoing maintenance.
