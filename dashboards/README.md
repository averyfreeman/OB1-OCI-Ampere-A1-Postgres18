# Active dashboards

This directory contains only dashboard resources used by the current
deployment.

| Surface | Purpose | Deployment |
| --- | --- | --- |
| [open-brain-dashboard-next/](open-brain-dashboard-next/) | Operator dashboard for the OCI API | systemd service ob1-dashboard on port 3000 |
| [ob1-canonical-landing/](ob1-canonical-landing/) | Static public project landing page | GitHub Pages via [deploy-pages.yml](../.github/workflows/deploy-pages.yml) |

Alternate dashboards and the scaffold template are preserved locally under
BACKUP_RESOURCES/dashboards/ and are not tracked by default. Restore one only
for an explicit migration or comparison task.
