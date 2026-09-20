## Project context
Generated: September 17, 2026 by [codebase-mcp](https://github.com/Dipanshu-js/codebase-mcp)

**OB1** vunknown

## Stack
- Language: **JavaScript**

## Tooling
GitHub Actions

## Structure
```
├── .claude/  # 1 files
│   └── skills/  # 1 files
├── .eos/  # 7 files
│   ├── features/  # 0 files
│   ├── graph/  # 4 files
│   ├── index/  # 4 files
│   │   └── ast/  # 0 files
│   ├── knowledge/  # 2 files
│   │   ├── architecture/  # 3 files
│   │   └── decisions/  # 0 files
│   ├── traces/  # 6 files
│   ├── workflows/  # 2 files
│   │   ├── active/  # 0 files
│   │   └── completed/  # 0 files
│   └── config.yaml
├── .github/  # 8 files
│   ├── ISSUE_TEMPLATE/  # 8 files
│   ├── scripts/  # 4 files
│   ├── workflows/  # 11 files
│   ├── metadata.schema.json
│   ├── ob1-logo-wide.png
│   ├── ob1-logo.png
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── release-drafter.yml
├── dashboards/  # 6 files
│   ├── _template/  # 2 files
│   ├── ob1-canonical-landing/  # 11 files
│   │   └── imgs/  # 5 files
│   ├── open-brain-dashboard/  # 8 files
│   │   ├── src/  # 6 files
│   │   └── static/  # 6 files
│   ├── open-brain-dashboard-next/  # 19 files
│   │   ├── app/  # 13 files
│   │   ├── components/  # 21 files
│   │   ├── lib/  # 5 files
│   │   └── public/  # 1 files
│   ├── open-brain-dashboard-pro/  # 14 files
│   │   ├── app/  # 11 files
│   │   ├── components/  # 12 files
│   │   ├── docs/  # 1 files
│   │   ├── lib/  # 4 files
│   │   └── public/  # 0 files
│   └── README.md
├── docs/  # 21 files
│   ├── assets/  # 1 files
│   │   └── agent-memory/  # 19 files
│   ├── drafts/  # 6 files
│   ├── examples/  # 1 files
│   ├── walkthroughs/  # 1 files
│   │   └── ob1-agent-dashboard/  # 13 files
│   ├── 01-getting-started.md
│   ├── 02-companion-prompts.md
│   ├── 03-faq.md
│   ├── 04-ai-assisted-setup.md
│   ├── 05-tool-audit.md
│   ├── agent-memory-oci-scopes.md
│   ├── agent-memory-portability.md
│   ├── ingestion-metadata-contract.md
│   ├── open-brain-assistant-gpt-context.md
│   ├── open-brain-credential-tracker.xlsx
│   ├── open-brain-guide-mac-tabbed.xlsx
│   ├── open-brain-guide-mac.xlsx
│   ├── open-brain-guide-windows-tabbed.xlsx
│   ├── open-brain-guide-windows.xlsx
│   ├── safe-agent-memory-provenance.md
│   ├── video-walkthrough-script.md
│   └── workflow-pipeline.html
├── extensions/  # 8 files
│   ├── _template/  # 3 files
│   ├── family-calendar/  # 5 files
│   ├── home-maintenance/  # 5 files
│   ├── household-knowledge/  # 5 files
│   ├── job-hunt/  # 5 files
│   ├── meal-planning/  # 6 files
│   ├── professional-crm/  # 5 files
│   └── README.md
├── integrations/  # 20 files
│   ├── _template/  # 2 files
│   ├── agent-memory-api/  # 5 files
│   │   └── smoke/  # 3 files
│   ├── chrome-capture-extension/  # 10 files
│   │   ├── background/  # 3 files
│   │   ├── content-scripts/  # 4 files
│   │   ├── data/  # 1 files
│   │   ├── docs/  # 1 files
│   │   ├── icons/  # 5 files
│   │   ├── lib/  # 9 files
│   │   └── popup/  # 5 files
│   ├── consolidation-workers/  # 6 files
│   │   ├── _shared/  # 3 files
│   │   ├── bio/  # 1 files
│   │   └── metadata-norm/  # 1 files
│   ├── delete-thought-mcp/  # 4 files
│   ├── discord-capture/  # 2 files
│   ├── enhanced-mcp/  # 5 files
│   │   └── _shared/  # 2 files
│   ├── entity-extraction-worker/  # 5 files
│   │   └── _shared/  # 2 files
│   ├── hermes-agent-memory/  # 4 files
│   │   └── plugin/  # 4 files
│   ├── kubernetes-deployment/  # 6 files
│   │   └── k8s/  # 3 files
│   ├── oci-node/  # 10 files
│   │   ├── migrations/  # 2 files
│   │   ├── src/  # 14 files
│   │   ├── systemd/  # 2 files
│   │   └── test/  # 4 files
│   ├── open-brain-rest/  # 5 files
│   │   └── smoke/  # 2 files
│   ├── openclaw-agent-memory/  # 8 files
│   │   └── plugin/  # 9 files
│   ├── readwise-capture/  # 3 files
│   ├── rest-api/  # 5 files
│   │   └── _shared/  # 2 files
│   ├── slack-capture/  # 2 files
│   ├── smart-ingest/  # 5 files
│   │   └── _shared/  # 2 files
│   ├── telegram-capture/  # 2 files
│   ├── update-thought-mcp/  # 4 files
│   └── README.md
├── primitives/  # 7 files
│   ├── _template/  # 2 files
│   ├── deploy-edge-function/  # 2 files
│   ├── remote-mcp/  # 2 files
│   ├── rls/  # 2 files
│   ├── shared-mcp/  # 2 files
│   ├── troubleshooting/  # 2 files
│   └── README.md
├── recipes/  # 53 files
│   ├── _template/  # 2 files
│   ├── adaptive-capture-classification/  # 5 files
│   ├── atomizer/  # 8 files
│   │   └── lib/  # 3 files
│   ├── authorship-edges/  # 6 files
│   │   └── lib/  # 2 files
│   ├── auto-capture/  # 2 files
│   ├── brain-backup/  # 3 files
│   ├── brain-health-monitoring/  # 3 files
│   ├── brain-smoke-test/  # 4 files
│   ├── bring-your-own-context/  # 4 files
│   ├── chatgpt-conversation-import/  # 6 files
│   ├── claudeception/  # 3 files
│   ├── content-fingerprint-dedup/  # 2 files
│   ├── daily-digest/  # 3 files
│   ├── edge-function-cost-optimization/  # 4 files
│   │   ├── examples/  # 2 files
│   │   └── migrations/  # 1 files
│   ├── editorial-policy/  # 6 files
│   │   └── auditor/  # 2 files
│   ├── email-history-import/  # 4 files
│   ├── entity-wiki/  # 3 files
│   ├── fingerprint-dedup-backfill/  # 5 files
│   ├── gmail-smart-pull/  # 4 files
│   │   ├── scripts/  # 3 files
│   │   └── sql/  # 2 files
│   ├── google-activity-import/  # 4 files
│   ├── grok-export-import/  # 4 files
│   ├── infographic-generator/  # 4 files
│   ├── instagram-import/  # 4 files
│   ├── journals-blogger-import/  # 4 files
│   ├── life-engine/  # 4 files
│   ├── life-engine-video/  # 2 files
│   ├── lint-sweep/  # 5 files
│   ├── live-retrieval/  # 3 files
│   ├── local-brain-no-mcp/  # 6 files
│   │   ├── functions/  # 4 files
│   │   └── volumes/  # 1 files
│   ├── local-ollama-embeddings/  # 4 files
│   ├── ob-graph/  # 6 files
│   ├── obsidian-vault-import/  # 4 files
│   ├── openclaw-agent-memory/  # 4 files
│   │   ├── contracts/  # 3 files
│   │   └── examples/  # 3 files
│   ├── openclaw-code-review-memory/  # 3 files
│   │   └── examples/  # 2 files
│   ├── openclaw-taskflow-work-log/  # 3 files
│   │   └── examples/  # 2 files
│   ├── panning-for-gold/  # 3 files
│   ├── perplexity-conversation-import/  # 4 files
│   ├── provenance-chains/  # 5 files
│   ├── readwise-import/  # 4 files
│   ├── repo-learning-coach/  # 18 files
│   │   ├── curriculum/  # 1 files
│   │   ├── public/  # 1 files
│   │   ├── research/  # 3 files
│   │   ├── server/  # 7 files
│   │   └── src/  # 5 files
│   ├── research-to-decision-workflow/  # 3 files
│   ├── schema-aware-routing/  # 3 files
│   ├── source-filtering/  # 3 files
│   ├── thought-enrichment/  # 7 files
│   │   └── lib/  # 2 files
│   ├── typed-edge-classifier/  # 3 files
│   ├── vercel-neon-telegram/  # 9 files
│   │   ├── scripts/  # 3 files
│   │   ├── sql/  # 2 files
│   │   └── src/  # 2 files
│   ├── weekly-digest/  # 3 files
│   ├── wiki-compiler/  # 3 files
│   ├── wiki-synthesis/  # 4 files
│   │   ├── dashboard-snippets/  # 2 files
│   │   └── scripts/  # 2 files
│   ├── work-operating-model-activation/  # 5 files
│   ├── world-model-diagnostic-activation/  # 3 files
│   ├── x-twitter-import/  # 4 files
│   └── README.md
├── resources/  # 6 files
│   ├── heavy-file-ingestion-claude-code.zip
│   ├── heavy-file-ingestion-claude-desktop.skill
│   ├── heavy-file-ingestion-codex.zip
│   ├── open-brain-companion.skill
│   ├── open-brain-companion.zip
│   └── README.md
├── schemas/  # 18 files
│   ├── _template/  # 2 files
│   ├── agent-memory/  # 3 files
│   ├── brain-stats-daily/  # 4 files
│   │   └── dashboard-snippets/  # 2 files
│   ├── crm-person-tiers/  # 4 files
│   │   └── dashboard-snippets/  # 2 files
│   ├── enhanced-thoughts/  # 3 files
│   ├── entity-extraction/  # 3 files
│   ├── per-agent-identity/  # 3 files
│   ├── provenance-chains/  # 3 files
│   ├── readwise-books/  # 3 files
│   ├── recency-boosted-match-thoughts/  # 3 files
│   ├── smart-ingest/  # 3 files
│   ├── text-search-trgm/  # 3 files
│   ├── thought-audit/  # 4 files
│   ├── thought-work-claims/  # 3 files
│   ├── typed-reasoning-edges/  # 3 files
│   ├── wiki-pages/  # 3 files
│   ├── workflow-status/  # 3 files
│   └── README.md
├── scripts/  # 1 files
│   └── update-readme-contributions.mjs
├── server/  # 4 files
│   ├── deno.json
│   ├── index.ts
│   ├── package.json
│   └── test-stateless.mjs
├── skills/  # 21 files
│   ├── _template/  # 3 files
│   ├── auto-capture/  # 3 files
│   ├── auto-capture-claude-code/  # 4 files
│   ├── autodream-brain-sync/  # 3 files
│   ├── claudeception/  # 3 files
│   ├── competitive-analysis/  # 3 files
│   ├── deal-memo-drafting/  # 3 files
│   ├── deleting-thoughts/  # 3 files
│   ├── financial-model-review/  # 3 files
│   ├── heavy-file-ingestion/  # 6 files
│   │   ├── references/  # 1 files
│   │   ├── scripts/  # 2 files
│   │   └── variants/  # 3 files
│   ├── meeting-synthesis/  # 3 files
│   ├── n-agentic-harnesses/  # 6 files
│   │   ├── agents/  # 1 files
│   │   ├── references/  # 11 files
│   │   └── variants/  # 2 files
│   ├── ob1-local-http/  # 3 files
│   ├── openclaw-agent-memory/  # 3 files
│   ├── panning-for-gold/  # 3 files
│   ├── research-synthesis/  # 3 files
│   ├── updating-thoughts/  # 3 files
│   ├── weekly-signal-diff/  # 4 files
│   │   └── references/  # 2 files
│   ├── work-operating-model/  # 3 files
│   ├── world-model-diagnostic/  # 3 files
│   └── README.md
├── .env
├── .gitignore
├── .mcp.json
├── AGENTS.md
├── CLAUDE.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── CONTRIBUTORS.md
├── LICENSE.md
├── prompt-builder-ideas.md
├── README.md
└── SECURITY.md
```

## Conventions
- No strong conventions detected

---
*Generated by [codebase-mcp](https://github.com/Dipanshu-js/codebase-mcp) — paste this into any AI tool*