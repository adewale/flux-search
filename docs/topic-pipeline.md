# Topic Pipeline

_Last updated: 2026-05-01_

This is the canonical documentation for the current Flux topic pipeline. Historical design notes remain in `specs/yaket-topics.spec.md`, `docs/topic-quality-research.md`, and `docs/topic-quality-experiments.md`, but this file describes production behavior today.

## Purpose

Topics are a navigation system for The FLUX Review archive. They power:

- issue-page topic chips;
- related issue links;
- `/topics` and `/topics/:keyword` pages;
- `topic:"..."` search filters;
- corpus-level audits and trend/timeline views.

A topic is considered good when it helps a reader orient within an issue or move through the archive. Extractor score alone is not enough.

## Current production shape

### Data flow

```text
issues.full_text_plain
  ↓
CleanText constructor
  ↓
proposal generators
  - known entities
  - phrase lexicon
  - heuristic entities
  - YAKE fallback
  ↓
constructCandidate()
  ↓
typed/evidence-backed issue candidates
  ↓
issue-level reranking
  ↓
cross-issue candidate floor
  ↓
issue_topics
  ↓
buildCorpusTopics()
  ↓
corpus_topics + topic_timeline + annotations
  ↓
/topics, /topics/:keyword, /issues/issue/:number, topic filters
```

### Control flow

```text
POST /admin/rebuild-topics
  ↓
create pipeline_run
  ↓
build phrase lexicon
  ↓
enqueue topic-extract-batch jobs
  ↓
enqueue topic-finalize-rebuild job
  ↓
queue consumer processes extraction batches
  ↓
finalize job waits for all extraction batches
  ↓
finalize persists issue_topics and rebuilds corpus tables
  ↓
embed-corpus-topics jobs update topic embeddings/similarities
  ↓
pipeline_run completed
```

The queue-backed route replaced the old monolithic Worker rebuild after the monolithic path exceeded Cloudflare CPU limits during `extract_issue_topics`.

## Ordering rules that matter

The topic pipeline ordering is:

```text
propose → construct → rank → cross-issue filter → persist → aggregate → public rank
```

Do not reorder these stages casually.

| Rule | Why it matters | Failure mode if violated |
| --- | --- | --- |
| Clean text before proposal generation | Decoded pseudo-tags and HTML artifacts must be removed before extraction | `img src`, `href img`, or similar artifacts become candidates |
| Candidate construction before ranking/persistence | Invalid strings should never become rankable persisted topics | malformed phrases survive into `issue_topics` and can aggregate publicly |
| Registry deny/blocklist before allow/protection | Explicit operator decisions must win | protected-looking bad strings can leak |
| Issue reranking before cross-issue floor | Local evidence determines which candidates are worth considering corpus-wide | weak local topics can crowd out salient issue topics |
| Cross-issue filter before `issue_topics` persistence in full rebuilds | One-off curiosities should not become public topic candidates | hapaxes pollute `issue_topics` and aggregate logic |
| Corpus aggregation after all issue batches succeed | Corpus evidence is global | partial rebuilds create misleading public counts/rankings |
| Public rank/demotion after base aggregation and domain boosts | Redundancy rules need to see surviving corpus topics | `crypto` and `cryptocurrency` can occupy adjacent top ranks |

The search pipeline has a separate ordering rule documented in `docs/architecture.md`:

```text
rank → detect sections → filter by section → compute aggregates → paginate
```

Both pipelines should be tested as pipelines, not only as individual functions.

## Stage-by-stage implementation

### 1. Clean text boundary

File: `src/lib/clean-text.ts`

`CleanText` is a branded string created by constructors such as `cleanTextFromHtml()` / `cleanTextFromPlain()`. The constructor removes tag-shaped decoded artifacts while preserving normal prose comparisons like `A < B > C`.

Invariant:

```text
Extractor inputs should not contain HTML/pseudo-tag artifacts.
```

### 2. Candidate proposals

Files:

- `src/lib/topic-multi-extract.ts`
- `src/lib/known-entities.ts`
- `src/lib/pmi-lexicon.ts`
- `src/lib/heuristic-entities.ts`
- `src/lib/topic-extractor.ts`

Proposal sources:

1. known entities;
2. phrase lexicon;
3. heuristic capitalized entities;
4. YAKE fallback.

Generators are allowed to be noisy. They do not define validity.

### 3. Candidate construction

Files:

- `src/lib/topic-candidate.ts`
- `src/lib/topic-registry.ts`

`constructCandidate()` converts a `CandidateProposal` into either:

```ts
{ ok: true, value: ConstructedTopicCandidate }
```

or:

```ts
{ ok: false, reason: CandidateRejection }
```

Construction enforces:

- canonical key;
- display label;
- `topicType`;
- `qualityStatus`;
- `eligibilityStatus`;
- local evidence;
- registry deny decisions;
- phrase grammar checks.

Invalid candidates are rejected before ranking or persistence.

### 4. Issue-level ranking

File: `src/lib/issue-topic-ranking.ts`

Issue ranking combines:

- domain distinctiveness;
- early/title/heading position;
- occurrence/spread;
- provenance;
- protected-topic boost.

Gold test harness:

```text
test/issue-topic-gold.test.ts
```

### 5. Cross-issue candidate floor

File: `src/lib/topic-cross-issue-filter.ts`

Full rebuilds apply a cross-issue floor before writing final `issue_topics`. This keeps one-issue curiosities out of the durable issue-topic table.

### 6. Persistence

Tables:

- `issue_topics`
- `corpus_topics`
- `topic_timeline`
- `pipeline_runs`
- `pipeline_jobs`
- `pipeline_phases`
- `topic_embeddings`

Important persisted fields:

```text
topic_type
quality_status
eligibility_status
evidence_json
provenance
suppression_reason
stem
```

`corpus_topics.topic_type` is derived from the dominant non-unknown issue-topic type during aggregation. Tail topics may remain `unknown` when evidence is ambiguous.

### 7. Corpus aggregation and public ranking

File: `src/db/topic-queries.ts`

Aggregation:

- groups stem variants;
- applies document-frequency floor;
- excludes blocklisted topics;
- computes aggregate score and distinctiveness;
- applies domain-distinctiveness boost;
- applies public redundancy demotions;
- prunes nested phrase fragments;
- annotates confidence and burst metadata.

Current public redundancy rule:

```text
crypto and cryptocurrency remain separate canonical topics;
cryptocurrency is demoted in public ranking when both are present.
```

### 8. Public routes

Files:

- `src/routes/topics.ts`
- `src/routes/issues.ts`
- `src/routes/search.ts`

Browser topic links must route to HTML/SPAs, not JSON-only APIs. Protected topic route checks live in the benchmark script.

## Queue-backed rebuild

### Planner route

```text
POST /admin/rebuild-topics
```

Protected by `ADMIN_TOKEN`.

Planner responsibilities:

1. create `pipeline_runs` row;
2. load active issues;
3. build phrase lexicon;
4. enqueue `topic-extract-batch` jobs;
5. enqueue one `topic-finalize-rebuild` job.

### Queue message kinds

| Kind | Purpose |
| --- | --- |
| `topic-extract-batch` | Extract constructed candidates for a bounded issue batch and store results in `pipeline_jobs.result_json` |
| `topic-finalize-rebuild` | Wait for extraction batches, apply global filters, persist tables, enqueue embeddings |
| `embed-corpus-topics` | Embed corpus topic labels and rebuild topic similarities |

### Durable state

`pipeline_jobs` stores:

- job ID;
- run ID;
- kind;
- semantic idempotency key;
- payload JSON;
- status;
- attempts;
- result JSON;
- error fields.

Duplicate delivery is handled by durable idempotency keys and job claiming.

### Finalize barrier

`topic-finalize-rebuild` is the barrier. It must not finalize until every `topic-extract-batch` for the run has succeeded. If extraction is incomplete, it throws a retryable “temporarily unavailable” error and the queue retries later.

## Testable invariants

| Invariant | How to check |
| --- | --- |
| Known bad topics are absent from public corpus | `npm run benchmark:topic-quality` |
| Protected topics remain present and route to HTML | `npm run benchmark:topic-quality` |
| Issue gold set does not regress | `test/issue-topic-gold.test.ts` and benchmark reports |
| Queue-backed rebuild completes with all jobs succeeded | `npm run smoke:admin-topic-rebuild` |
| No stale active jobs after rebuild smoke | `/admin/pipeline-runs/:id/jobs` |
| Corpus topics carry quality/eligibility state | D1 query on `corpus_topics` |
| High-impact topics carry `topic_type` | D1 query on top corpus topics |
| Public topic count remains explainable | benchmark report + `docs/topic-system-status.md` |

## Current scorecard

Source: `reports/correct-by-construction/new-system-typed-corpus-deduped-ranking.json`

| Metric | Old baseline | Current system | Change |
| --- | ---: | ---: | ---: |
| Public topic count | 127 | 134 | +7 |
| Issue gold average hits@5 | 2.64 | 3.40 | +0.76 |
| Minimum hits@5 | 0 | 2 | +2 |
| Issues with >=3 hits@5 | 15 / 25 | 21 / 25 | +6 issues |
| Issues with >=4 hits@5 | 5 / 25 | 12 / 25 | +7 issues |
| Known bad/artifact topics present | 0 | 0 | no regression |

Verdict: the correct-by-construction approach is yielding better results than the old system while preserving artifact suppression.

## Design decisions

### Why queue-backed?

The full rebuild outgrew one Worker invocation. Queue-backed batches keep each invocation bounded and make progress inspectable/retryable.

### Why keep `crypto` and `cryptocurrency` separate?

Flux uses `crypto` for the broad ecosystem and `cryptocurrency` for the narrower asset/currency concept. They are distinct canonical topics, but public ranking avoids placing both at the top.

### Why allow `unknown` topic types?

Wrong certainty is worse than honest uncertainty. High-impact topics should be typed; ambiguous tail topics can remain `unknown` until curation improves UI, aliasing, ranking, or audits.

### Why keep blocklists?

Correct-by-construction reduces invalid candidates early, but explicit deny/blocklist entries are still the operator override and must win over allow/protection entries.

### Why use `nodewordfreq` offline only?

Background frequencies are build/calibration data, not Worker runtime behavior. The Worker imports generated frequency data and preserves attribution in `docs/background-frequency-attribution.md`.

## Operational quick reference

Full rollout:

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run rollout:topic-quality
```

Benchmark current production:

```bash
npm run benchmark:topic-quality
```

Rebuild smoke:

```bash
ADMIN_TOKEN="$ADMIN_TOKEN" npm run smoke:admin-topic-rebuild
```

Inspect runs:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://flux-search.adewale-883.workers.dev/admin/pipeline-runs?limit=5
```

Inspect jobs:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://flux-search.adewale-883.workers.dev/admin/pipeline-runs/$RUN_ID/jobs?limit=500
```

See also: `docs/topic-operations.md`.
