# OB1 Prompt Builder and FAR Report

**Reviewed:** 2026-09-17  
**Target deployment:** OCI Node.js 24 service backed by local PostgreSQL 18 and `pgvector`  
**Recommendation:** Make OB1 the canonical prompt catalog and FAR (Frequently Prompted Requests) system, with generated Markdown/JSON exports for clients that cannot reach the catalog.

## Executive answer

### Does OB1 currently have a prompt repository?

Not as a first-class product capability.

OB1 already contains a useful distributed prompt library:

- [`docs/02-companion-prompts.md`](docs/02-companion-prompts.md) contains memory migration, second-brain migration, use-case discovery, capture templates, and weekly-review prompts.
- [`skills/`](skills/) contains reusable agent behaviors, including auto-capture, research, project context, and OpenClaw memory workflows.
- [`recipes/`](recipes/) contains specialized extraction, enrichment, import, and operating-model prompts.
- [`server/index.ts`](server/index.ts) exposes deliberate memory operations such as `capture_thought`, `search_thoughts`, and `list_thoughts`.

These are repository assets, not a searchable, versioned prompt product. There is currently no canonical prompt family, immutable prompt-version history, variable schema, prompt-run record, outcome record, FAR recommendation view, or prompt-version comparison surface.

### Does OB1 save every AI conversation in full by default?

No. The core model is capture-driven. An AI client has to call an OB1 capture/write-back operation, or a configured importer or lifecycle adapter has to send data. OB1 cannot passively observe every conversation merely because an MCP server is connected.

The current repository has several distinct behaviors:

| Path | Default behavior | Full conversation retained? |
| --- | --- | --- |
| Core MCP capture | Saves an explicit, standalone thought or structured write-back | No |
| OpenClaw/Hermes memory adapters | Recall before work and write compact findings after work | No raw transcript by default |
| ChatGPT export importer | Extracts a small number of durable thoughts from meaningful conversations | No, unless an explicit raw mode is selected |
| ChatGPT importer `--raw` | Sends user messages directly as import material | It can retain much more source text; use deliberately |
| ChatGPT importer `--store-conversations` | Stores conversation metadata and pyramid summaries | Summaries, not the full dialogue |
| Claude Code transcript-capture skill | An opt-in client hook can send a formatted session transcript | Yes, for that explicitly installed path |

The relevant importer documentation is [`recipes/chatgpt-conversation-import/README.md`](recipes/chatgpt-conversation-import/README.md). The relevant transcript behavior is explicitly described in [`skills/auto-capture-claude-code/SKILL.md`](skills/auto-capture-claude-code/SKILL.md). Those exceptions should not be confused with the default OB1 memory contract.

Also, an AI client may retain its own conversation history outside OB1. OB1 only receives what a client, plugin, hook, or import workflow sends to it.

## The problem this feature should solve

The repeated prompt-writing problem is not primarily a shortage of prompt wording. It is a failure to preserve and retrieve a useful task specification.

A strong reusable prompt usually contains:

1. Goal: why the work matters.
2. Request: what the agent must do.
3. Context: repository, system, audience, or prior decisions.
4. Action steps: the sequence the agent should follow.
5. Constraints: what must not change and what is out of scope.
6. Deliverable type: code, report, plan, migration, review, or other artifact.
7. Acceptance criteria: how completion will be judged.
8. Stop conditions: when the agent must ask, pause, or refuse to guess.
9. Variables: the parts that change from one invocation to the next.
10. Output format: the shape the user can consume.

The proposed Prompt Builder should convert those recurring structures into reusable templates. FAR should identify the requests that recur often enough to deserve a template, then show the user which versions actually produce useful outcomes.

## Options considered

### Option 1: File-based prompt library

Store prompts in Markdown, YAML, or JSON under the repository.

**Benefits**

- Simple to inspect, review, diff, branch, and export.
- Works offline and with clients that cannot call an MCP server.
- Fits the existing `skills/`, `recipes/`, and documentation conventions.
- Low implementation and operational cost.

**Drawbacks**

- Weak personalization across projects and harnesses.
- Prompt usage, outcomes, feedback, and version comparisons require separate conventions.
- Agents may copy stale files or fail to find the right prompt.
- A file cannot naturally aggregate outcome evidence across many runs.

**Best use:** portable project scaffolds and human-authored baseline prompts.

### Option 2: OB1-first prompt catalog

Store prompt families, versions, runs, outcomes, and feedback in PostgreSQL. Expose them through REST and a purpose-built MCP.

**Benefits**

- Directly supports personal FAR recommendations.
- Reuses OB1 scope, provenance, review, hybrid search, and audit patterns.
- Makes prompt discovery available to every connected harness.
- Allows success data to be segmented by model, harness, project, and task type.
- Gives prompt variables, acceptance criteria, and deliverables a typed home.

**Drawbacks**

- Requires schema, API, dashboard, and adapter work.
- Clients without MCP access need an export or synchronization path.
- A database catalog needs careful versioning so generated suggestions do not silently replace trusted prompts.

**Best use:** a personal and cross-harness prompt memory system.

### Option 3: OB1 catalog with generated portable exports

Use the OB1-first catalog as the source of truth, but render selected active prompts to Markdown or JSON for repositories, skills, and offline clients.

This is the recommended compatibility mechanism, not a second canonical catalog. Each export should carry the prompt family ID, version ID, generated timestamp, and a link or reference back to OB1. Local copies can be stale; they must not be treated as authoritative edits.

## Recommendation

Choose Option 2 as the product architecture and Option 3 as the delivery mechanism.

OB1 should own the prompt lifecycle. Repository files should remain valuable, but primarily as exported, reviewable, portable artifacts or as deliberately imported source material.

The first version should not attempt to become an autonomous prompt optimizer. It should do four things reliably:

1. Find a useful prompt pattern.
2. Render it with explicit variables and acceptance criteria.
3. Record what happened when it was used.
4. Suggest a new version only when evidence justifies it.

## Proposed prompt model

### Prompt family

A stable identity for a recurring request, for example:

- `implement-feature`
- `debug-production-failure`
- `research-and-compare`
- `write-architecture-report`
- `review-pull-request`
- `summarize-meeting-and-extract-actions`

A family has a human-readable name, domain, scope, owner, lifecycle status, and a short description. It does not contain mutable prompt text directly.

### Prompt version

Every change creates a new immutable version. A version contains:

```yaml
prompt_family_id: implement-feature
version: 4
status: active
goal: "Deliver a tested feature that satisfies the stated acceptance criteria."
request: "Implement the requested change in the repository."
context: "{{repository_context}}"
action_steps:
  - "Inspect the relevant code and existing tests."
  - "State any material assumption before editing."
  - "Implement the smallest complete change."
  - "Run the agreed verification commands."
constraints:
  - "Preserve unrelated user changes."
  - "Do not expose secrets."
deliverable_type: "code change"
acceptance_criteria:
  - "The requested behavior is implemented."
  - "Relevant tests pass."
stop_conditions:
  - "Ask before a destructive or materially out-of-scope action."
variables:
  - name: repository_context
    type: text
    required: true
output_format: "Summary, files changed, verification, remaining risks"
```

The exact serialization can be JSONB in PostgreSQL, with a rendered Markdown form for humans and simpler clients. The database should validate required fields and variable types before a version becomes active.

### FAR entry

A FAR entry is a derived recommendation, not necessarily a new prompt version. It should include:

- recurring request signature;
- recommended prompt family and version;
- matched domains and deliverable types;
- typical variables and missing information;
- successful and unsuccessful run counts;
- evidence quality and confidence;
- representative approved examples;
- known failure modes;
- last-used and last-reviewed timestamps.

FAR should recommend a template when it reduces repeated effort, not merely because two prompts contain similar words.

## PostgreSQL design

The catalog belongs in the existing local PostgreSQL 18 database. It should use the existing `pgvector` and full-text-search approach rather than creating a separate retrieval subsystem.

Conceptual tables:

| Table | Purpose |
| --- | --- |
| `prompt_families` | Stable identity, description, domain, owner, scope, and lifecycle |
| `prompt_versions` | Immutable structured prompt definitions and rendered source |
| `prompt_runs` | One invocation of one prompt version by one harness |
| `prompt_outcomes` | Structured success state, checks, ratings, and evidence |
| `prompt_feedback` | Corrections, comments, preferences, and user overrides |
| `prompt_exports` | Generated Markdown/JSON artifacts and their source version |
| `prompt_relations` | Supersedes, derived-from, duplicate-of, and related relationships |

Important fields should include `workspace_id`, `project_id`, `visibility`, `agent_id`, `client_surface`, `runtime_name`, `model`, `task_id`, `flow_id`, `source_refs`, `content_hash`, and timestamps.

Prompt versions should have a `halfvec(3072)` embedding and a full-text index over the structured text or a canonical search document. This preserves the existing embedding contract while adding exact retrieval for prompt names, variable names, issue IDs, commands, and deliverable labels.

Retrieval should be hybrid:

1. Apply authorization and scope filters first.
2. Match exact family names, tags, variables, and deliverable types.
3. Use full-text ranking for syntax and terminology.
4. Use vector similarity for semantically related requests.
5. Re-rank by outcome evidence, recency, scope fit, and version status.

Semantic similarity alone must not decide which prompt is active.

## Scope and governance

Prompt access should use the existing workspace/project/personal/channel boundaries, but prompt permissions should be distinct from ordinary memory write-back where possible:

- `prompt_use`: search and render prompts.
- `prompt_author`: create candidate versions and feedback.
- `prompt_publish`: activate or roll back versions.
- `prompt_admin`: manage all prompt scopes and exports.

The server, not the model, owns authorization. Intent classification can rank a code, research, personal, or operations prompt, but it must never grant access or change scope.

Recommended lifecycle:

```text
draft → candidate → active_suggestion → pinned → deprecated
                         ↓
                     rolled_back
```

- `draft`: incomplete or private authoring.
- `candidate`: derived or submitted for review.
- `active_suggestion`: eligible for automatic recommendation but not a silent replacement.
- `pinned`: explicitly selected by the user or project.
- `deprecated`: no longer recommended but retained for history.
- `rolled_back`: withdrawn because evidence or feedback showed a problem.

High-confidence automatic publication may create an `active_suggestion`, but it must never modify an existing version in place or silently replace a pinned prompt.

## Purpose-built MCP

A dedicated prompt MCP is useful because it gives each harness the same small protocol while allowing each harness to decide when to call it.

### `prompt_search`

Input:

```json
{
  "goal": "merge a repository scaffold",
  "deliverable_type": "implementation plan",
  "domain": "code",
  "workspace_id": "default",
  "project_id": "ob1",
  "harness": "codex",
  "limit": 5
}
```

Output: scoped prompt families and versions with IDs, required variables, acceptance criteria, outcome summaries, and confidence intervals.

### `prompt_render`

Render one authorized version with supplied variables. Return missing variables and validation errors instead of silently filling critical blanks.

### `prompt_start`

Create a `run_id` for one prompt invocation. Record prompt version, harness, model, project, task, and non-sensitive input fingerprints. The default must not persist the full conversation.

### `prompt_record_outcome`

Attach a structured result to a run:

```json
{
  "run_id": "...",
  "status": "success",
  "acceptance_checks": [
    {"id": "tests-pass", "passed": true, "source": "ci", "evidence_ref": "..."}
  ],
  "deliverable_adherence": 0.9,
  "human_rating": 4,
  "correction_count": 1,
  "artifact_refs": ["repo://..."],
  "notes": "Required behavior shipped after one minor correction."
}
```

Evidence references should point to a commit, CI run, report, test result, or other inspectable artifact. They should not require storing a raw transcript.

### `prompt_suggest`

Derive a candidate from a completed run or approved session summary. Apply redaction, structural validation, duplicate detection, and scope before saving.

### `prompt_compare`

Compare prompt versions by a declared cohort: same task family, project type, harness, model, or outcome contract. Do not claim that one version is better when the cohorts are materially different.

### `prompt_publish` and `prompt_rollback`

These are review-controlled operations. Automatic mining can create an `active_suggestion` under the configured gate; user or authorized reviewer action is required to pin, restrict, or roll back a prompt.

The MCP should be a recording and retrieval boundary. It should not expose an arbitrary remote shell or claim that it can independently inspect every repository. Local evaluators, CI, and harness adapters should submit evidence through `prompt_record_outcome`.

## Continuous mining

The chosen direction is continuous mining, but the safe interpretation is continuous derived-signal collection—not silent archival of every message.

### Pipeline

1. A harness emits a lifecycle event or the user invokes prompt mining.
2. The local adapter identifies the task request, selected prompt, deliverable, and outcome signals.
3. Sensitive values, credentials, raw reasoning traces, and large code blocks are removed.
4. The adapter stores a bounded summary, content hashes, source references, and structured evidence.
5. OB1 clusters recurring request shapes and searches for existing prompt families.
6. A candidate prompt is generated only when the source has enough structure to be reusable.
7. The candidate is deduplicated and scored against existing versions.
8. High-confidence candidates may become `active_suggestion` versions under the publication gate.

### Harness feasibility

| Harness | Continuous mining feasibility | Recommended first integration |
| --- | --- | --- |
| OpenClaw | High; lifecycle and memory hooks are available | Capture prompt run and outcome at task boundaries |
| Hermes | High; memory-provider lifecycle is available | Capture structured findings and completion signals |
| Codex CLI | Medium; MCP use is available, but passive conversation observation requires a client-side hook or adapter | Explicit `prompt_start`/`prompt_record_outcome`, then add a local adapter if supported |
| ChatGPT desktop | Medium to low for passive mining; MCP is callable, but the server cannot observe messages the client never sends | User-invoked search/render/record calls or a local desktop-side adapter |

MCP expands the common interface, but it does not eliminate client integration limits.

## Automatic publication gate

Because the selected policy is high-confidence auto-publication, the gate should be explicit:

1. The candidate passes secret and sensitive-content redaction.
2. The candidate validates against the prompt schema.
3. It is not a near-duplicate of an active or pinned version.
4. It has at least five comparable completed runs, or is marked `candidate` rather than `active_suggestion`.
5. Its lower confidence bound exceeds the existing family baseline, or it has a clear structural improvement with no negative evidence.
6. It creates a new immutable version with a provenance link to its source runs.
7. The previous active or pinned version remains available for immediate rollback.

Automatic publication should be disabled for prompts involving sensitive personal, financial, legal, health, credential, or destructive operational instructions unless explicitly reviewed.

## Can prompt success be scored?

Yes, but not by comparing the wording of a prompt to the output. That would measure linguistic resemblance, not whether the requested work succeeded.

### Define the unit of measurement

The unit should be a `prompt_run`, not a prompt text blob. A run links:

- prompt family and immutable version;
- rendered variable fingerprints;
- harness and client surface;
- model and reasoning configuration;
- project and task identifiers;
- requested deliverable;
- acceptance criteria;
- evidence and final outcome.

### Initial scoring model

Use a multidimensional score rather than a single opaque model judgment:

```text
objective_score =
  0.45 × acceptance_criteria
+ 0.20 × deliverable_adherence
+ 0.20 × verification_evidence
+ 0.10 × human_acceptance
+ 0.05 × efficiency
```

If a dimension is unavailable, renormalize the available dimensions and mark confidence lower. Unknown evidence must not automatically count as failure.

Examples of evidence:

| Task type | Strong evidence | Weak evidence |
| --- | --- | --- |
| Code | Tests, build, lint, CI, review, changed-file scope, feature checklist | Output looks plausible; prompt/output text similarity |
| Research | Source quality, citation coverage, contradiction handling, claim checklist, user acceptance | Number of words or confident tone |
| Writing | Required sections, audience fit, factual checks, user rating, revision count | Stylistic similarity to the prompt |
| Operations | Runbook checks, health signals, rollback readiness, incident resolution | Agent reports “done” without evidence |

### Success rate and confidence

Define `success` as an outcome meeting the declared threshold, for example `objective_score >= 0.75` with no critical acceptance failure. Store the continuous score as well as the binary result.

- Fewer than five comparable runs: show “insufficient evidence.”
- Five to nine runs: show a provisional rate.
- Ten or more runs: show a usable comparison, still stratified by cohort.
- Keep confidence intervals and sample size visible.
- Compare versions within similar task, harness, model, and project cohorts.
- Use matched tasks or controlled alternation before making causal claims.

A prompt can appear successful because the task was easy, the user repaired the result, or a better model supplied missing context. Outcome attribution must preserve those confounders.

### Quality feedback loop

The strongest loop is:

```text
prompt version → run → artifact/evidence → human or machine evaluation → aggregate by cohort → next suggestion
```

The system should learn from failures as well as successes. A prompt that often produces a superficially complete but untestable result should accumulate a negative lesson and a proposed acceptance-criteria improvement.

## Applying the model to the supplied prompt style

The supplied example has valuable structure:

- a clear overarching goal;
- a simplification mandate;
- technical requests;
- architectural requests;
- concrete tasks;
- constraints and caveats;
- a deliverable request.

The main weakness is that it combines several different work products into one very large request. A Prompt Builder should decompose it into a prompt family plus a project-specific brief:

1. **Architecture research prompt:** compare alternatives and make decisions.
2. **Implementation plan prompt:** turn approved decisions into a bounded sequence.
3. **Implementation prompt:** edit the repository with explicit file and test criteria.
4. **Review prompt:** inspect the result against acceptance criteria and risks.
5. **Documentation prompt:** produce the durable report and usage guide.

This decomposition preserves the user’s intent while making outcomes measurable. It also lets FAR recommend the right stage instead of repeatedly returning a giant all-purpose prompt.

### Reusable prompt outline

```markdown
# Goal
What durable outcome should exist when this run is complete?

# Request
What should the agent do now?

# Context
What repository, audience, prior decisions, or source material matters?

# Action steps
What sequence should the agent follow?

# Constraints
What must remain unchanged? What is explicitly out of scope?

# Deliverable
What artifact should be returned, and where should it live?

# Acceptance criteria
What observable checks determine completion?

# Stop conditions
When must the agent ask, pause, or report a blocker?

# Variables
Which fields change on every invocation?

# Output format
How should the result be summarized for the next person or agent?
```

## Correct and incorrect prompt examples

### Better request

```text
Goal: Add CSV import support to the local OB1 ingestion service.

Request: Inspect the existing file detector and ingestion worker, implement CSV parsing,
and preserve existing PDF/DOCX/image behavior.

Constraints: Do not change the embedding model or database contract. Preserve unrelated
working-tree changes. Reject files over the configured quota.

Deliverable: Code changes, tests, and a short README update.

Acceptance criteria:
- CSV headers and quoted fields parse correctly.
- Empty and malformed files fail with a useful error.
- Existing ingestion tests still pass.
- A new focused test covers a quoted multiline field.

Stop condition: Ask before changing the schema or deleting existing files.
```

This is easier to score because the task, boundaries, artifact, and checks are explicit.

### Weaker request

```text
Make the importer better, simplify everything, support more files, and update the docs.
Use your best judgment and make it production-ready.
```

This may produce a useful result, but there is no stable unit of work, no acceptance contract, and no way to distinguish a completed feature from an attractive partial rewrite.

## Is the “model training” analogy useful?

It is useful only as a limited metaphor.

**Helpful analogy:**

- A prompt is an interface contract.
- Examples are executable expectations.
- Acceptance criteria are labels or tests.
- Outcomes provide feedback.
- Versioned prompts allow controlled iteration.

**Misleading analogy:**

- One successful response does not train the model.
- A prompt score is not a model capability score.
- Repeatedly rewarding a convenient result can reinforce unsafe shortcuts.
- The same prompt can perform differently across models, tools, context windows, and task difficulty.

The product should call this an evaluation and improvement loop, not imply that OB1 is retraining the underlying model.

## Dashboard concept

The existing dashboard can add a Prompt Builder area with five focused surfaces:

1. **Catalog:** search families, filters, scope, domain, deliverable, and status.
2. **Builder:** edit variables, acceptance criteria, constraints, and output format.
3. **Run history:** show which harness and version were used.
4. **Outcome review:** show evidence, ratings, corrections, and confidence.
5. **FAR queue:** show recurring requests, proposed candidates, auto-published suggestions, and rollback controls.

The dashboard should make provenance visible: who authored a prompt, which model generated a candidate, which runs support its score, and which version is currently pinned.

## Phased action plan

### Phase 1: Catalog foundation

- Add PostgreSQL tables for families, immutable versions, runs, outcomes, feedback, exports, and relations.
- Add validation for prompt structure, variables, scope, and lifecycle transitions.
- Add exact and semantic search using the existing local database contract.
- Add redaction and content-size limits before persistence.

### Phase 2: Prompt MCP and REST contract

- Implement the eight tools described above.
- Add request and response schemas with stable version identifiers.
- Apply prompt-specific authorization before search, render, write, publish, or rollback.
- Preserve existing memory and ingestion routes unchanged.

### Phase 3: Dashboard

- Build catalog, builder, run, outcome, and FAR views.
- Add compare, pin, deprecate, and rollback actions.
- Display sample size and confidence beside every score.

### Phase 4: Harness integrations

- Add OpenClaw and Hermes lifecycle events first.
- Add explicit Codex CLI MCP workflows.
- Add a local desktop-side adapter only where the client exposes a safe lifecycle surface.
- Keep clients able to operate when the prompt service is unavailable by using the last exported version or a user-supplied prompt.

### Phase 5: Evaluators and recommendations

- Add evidence collectors for tests, builds, lint, CI, artifact presence, and human feedback.
- Add cohort-aware outcome aggregation.
- Enable high-confidence `active_suggestion` publication only after real run data exists.
- Add periodic review and automatic demotion for stale or repeatedly unsuccessful versions.

## Over-engineering gate

The full vision could become over-engineered if it starts with autonomous rewriting, universal transcript capture, or a complex model-judge pipeline.

The useful minimum is smaller:

1. A structured prompt catalog.
2. A render operation.
3. A prompt-run record.
4. A structured outcome operation.
5. Basic FAR grouping and search.

Do not build a prompt leaderboard until there are enough comparable runs. Do not auto-publish from wording similarity. Do not store full conversations merely to discover reusable structure when a bounded derived summary and evidence reference are sufficient.

## Acceptance tests

The implementation should verify:

- unauthorized harnesses cannot search or render prompts outside their scope;
- prompt versions are immutable after publication;
- a rollback restores the previous version without deleting history;
- secret-like values and large transcript/code payloads are rejected or redacted;
- duplicate candidates do not create duplicate families or versions;
- missing outcome evidence lowers confidence rather than becoming a false failure;
- score calculations are deterministic from stored evidence;
- code outcomes can reference tests, builds, CI, and review artifacts;
- research outcomes can reference sources and claim checks;
- automatic publication creates a new suggestion and never overwrites a pinned version;
- OpenClaw and Hermes can record runs through lifecycle hooks;
- Codex CLI can search and render through MCP explicitly;
- offline/exported prompts remain identifiable by family and version;
- existing OB1 memory capture, recall, ingestion, and embedding behavior remains unchanged.

## Final recommendation

OB1 is already a good durable-memory substrate for this feature, but it is not yet a prompt repository. It should be extended into an OB1-first prompt catalog rather than relying on increasingly large static prompt files.

The right first product is a structured Prompt Builder plus FAR discovery. The right second product is evidence-backed outcome scoring. A purpose-built MCP is the common interface that makes the system usable across harnesses, but lifecycle adapters and local evaluators are what make continuous mining and credible success measurement possible.

The system should remember prompt structure and results—not indiscriminately remember every conversation.

## References

- [OB1 companion prompts](docs/02-companion-prompts.md)
- [OB1 Agent Memory scope design](docs/agent-memory-oci-scopes.md)
- [ChatGPT conversation importer](recipes/chatgpt-conversation-import/README.md)
- [Agent auto-capture behavior](skills/auto-capture/SKILL.md)
- [Claude Code transcript-capture behavior](skills/auto-capture-claude-code/SKILL.md)
- [OpenClaw agent-memory integration](integrations/openclaw-agent-memory/README.md)
- [Hermes agent-memory integration](integrations/hermes-agent-memory/README.md)
- [The Prompt Collection](https://the-prompt-collection.github.io/)
- [The Prompt Collection repository README](https://github.com/the-prompt-collection/the-prompt-collection.github.io/blob/main/README.md)
