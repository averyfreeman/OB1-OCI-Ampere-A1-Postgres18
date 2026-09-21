# Maintaining the OB1 OCI deployment

This checkout is intentionally smaller than the upstream contribution
catalog. Changes should preserve the native OCI API, operator dashboard,
configured Pages landing page, and the maintenance automation around them.

## Before changing code

1. Create or use a dedicated worktree and branch.
2. Read the relevant operational reference in docs/.
3. Check the systemd unit or Pages workflow that consumes the files.
4. Keep secrets in /etc/ob1/*.env or another external secret store.

## Change boundaries

| Area | Scope |
| --- | --- |
| integrations/oci-node/ | API, ingestion, Agent Memory, migrations, tests, and service units |
| dashboards/open-brain-dashboard-next/ | Active operator UI and its build configuration |
| dashboards/ob1-canonical-landing/ | Static public landing page and brand assets |
| docs/ | Operational contracts, runbooks, and safety policy only |
| .github/ | CI, deployment, security, and review automation |

Resources under BACKUP_RESOURCES/ are archival. Restore one explicitly before
using it; do not silently reintroduce an alternate runtime or dashboard.

## Required checks

    cd integrations/oci-node
    /usr/bin/npm-24 test
    /usr/bin/npm-24 run build

    cd ../../dashboards/open-brain-dashboard-next
    npm run lint
    npm run build

    cd ../..
    node --test .github/scripts/gate-context.test.cjs
    python3 -B .github/scripts/test_gate_artifact.py

Run git diff --check and confirm git status --short contains only intended
changes before staging.

## Safety requirements

- Do not commit credentials, API keys, private environment files, or tokens.
- Do not store raw transcripts, model reasoning traces, secrets, or large code
  blocks in Agent Memory.
- Treat generated and inferred memory as evidence pending review.
- Use additive database migrations and preserve the existing embedding
  contract.
- Keep API and service paths stable unless the systemd units and dashboard
  configuration are updated in the same change.

## Commits and pull requests

Use a focused prefix such as [runtime], [dashboard], [docs], or [ci].
Describe the production behavior changed, the verification commands run, and
any migration or rollback consideration.
