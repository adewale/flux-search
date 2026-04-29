# Flux Search Queue Migration Spec

## Purpose

Define a Flux-specific plan for using Cloudflare Queues to make topic enrichment, ingest follow-up work, and future corpus maintenance more efficient, observable, and resilient.

This spec is additive. It preserves all public search, issue, topics, static asset, and admin-auth behavior while moving slow or retry-prone work out of foreground cron/admin paths and into small idempotent queue jobs.

Inputs:

- Cloudflare Queues documentation (`llms-full.txt`)
- Demoscene `specs/queues_spec.md`
- Demoscene `specs/queue_migration_checklist.md`
- Current Flux Search architecture: Workers + Hono + D1 + Vectorize + Workers AI

## Goals

- Keep the Worker responsive during admin/topic rebuilds.
- Prevent one bad issue/topic batch from failing an entire rebuild.
- Reduce cron runtime by using cron/admin routes as planners and queues as executors.
- Make retries and failures visible at the run/job level.
- Preserve the existing public API response contracts.
- Keep topic rebuilds and enrichment idempotent under duplicate delivery.
- Support DLQ inspection and replay after transient platform/API failures.

## Non-goals

- Rewriting search ranking or result response shape.
- Moving raw corpus files to R2.
- Queueing every ingest step immediately.
- Removing the current inline rebuild path before queue-backed runs are proven stable.
- Introducing non-Cloudflare infrastructure.

## Cloudflare Queues constraints to honor

From the Cloudflare Queues docs:

- Queue delivery is at-least-once; all consumers must be idempotent.
- A queue has one push consumer Worker.
- Consumer handlers receive batches; partial failures should use per-message `ack()` / `retry()`.
- `retry({ delaySeconds })` is the correct explicit transient backoff mechanism.
- `max_batch_size`, `max_batch_timeout`, `max_concurrency`, and `max_retries` are operational tuning knobs.
- DLQs should be configured for exhausted retries.
- `message.attempts` should be logged and/or persisted for diagnosis.
- `sendBatch()` is appropriate for fan-out, but payloads must carry enough context to debug and replay.
- Async work in a queue handler should be awaited or explicitly managed with `waitUntil()`; Flux should prefer awaiting message processing unless deliberately detaching a non-critical side effect.

## Current Flux queue status

Flux has started a narrow queue seam for topic enrichment:

- Queue binding: `ENRICHMENT_QUEUE`
- Queue name: `flux-enrichment`
- DLQ: `flux-topic-embed-dlq`
- Current consumer module: `src/jobs/enrichment-queue.ts`
- Initial message variant: `embed-corpus-topics`

This is a useful start, but it is not a full queue migration yet. The next steps are durable job state, idempotency, correlation IDs, and operator tooling.

## Proposed architecture

Use a planner/executor model:

```text
            ┌──────────────────────────────┐
            │ Weekly cron / admin endpoint │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │ Planner                      │
            │ - creates pipeline_run       │
            │ - computes work units        │
            │ - inserts pipeline_jobs      │
            │ - sendBatch() to queue       │
            │ - logs wide planner event    │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │ ENRICHMENT_QUEUE             │
            │ - embed-corpus-topics        │
            │ - rebuild-issue-topics       │
            │ - aggregate-topic-slice      │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │ Queue consumer               │
            │ - loads durable job          │
            │ - marks processing           │
            │ - executes idempotently      │
            │ - marks succeeded/deferred/  │
            │   failed                     │
            │ - ack/retry per message      │
            └──────────────┬───────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │ D1 source of truth           │
            │ - issues                     │
            │ - issue_topics               │
            │ - corpus_topics              │
            │ - topic_timeline             │
            │ - topic_similarity           │
            │ - pipeline_runs              │
            │ - pipeline_jobs              │
            │ - pipeline_phases            │
            └──────────────────────────────┘
```

Public read routes continue to read from D1 and must not depend on queued work being currently in progress.

## Queue topology

### Initial queue

Use one queue first:

```txt
ENRICHMENT_QUEUE -> flux-enrichment
DLQ              -> flux-topic-embed-dlq
```

Recommended conservative settings:

```jsonc
{
  "queue": "flux-enrichment",
  "max_batch_size": 25,
  "max_batch_timeout": 10,
  "max_concurrency": 5,
  "max_retries": 3,
  "dead_letter_queue": "flux-topic-embed-dlq",
  "retry_delay": 300
}
```

Rationale:

- Topic enrichment is parallelizable.
- D1 writes and Workers AI calls need bounded concurrency.
- A single queue keeps operational load small while the pattern is proven.

### Later queues

Only split queues if metrics show contention:

- `flux-topic-embed` for Workers AI embedding batches.
- `flux-topic-rebuild` for per-issue re-extraction.
- `flux-ingest-followup` for post-ingest maintenance.

## Message contract

All messages must be versioned and carry traceability fields.

```ts
export type EnrichmentMessage =
  | EmbedCorpusTopicsMessage
  | RebuildIssueTopicsMessage
  | AggregateTopicSliceMessage;

export interface QueueMessageBase {
  schemaVersion: 1;
  kind: string;
  runId: string;
  jobId: string;
  correlationId: string;
  queuedAt: string;
}

export interface EmbedCorpusTopicsMessage extends QueueMessageBase {
  kind: 'embed-corpus-topics';
  keywords: string[];
}

export interface RebuildIssueTopicsMessage extends QueueMessageBase {
  kind: 'rebuild-issue-topics';
  issueId: string;
  contentHash: string | null;
}

export interface AggregateTopicSliceMessage extends QueueMessageBase {
  kind: 'aggregate-topic-slice';
  keywords: string[];
}
```

### Idempotency keys

Each durable job should have a deterministic semantic key.

```txt
embed-corpus-topics:
  embed-corpus-topics:${sha256(sortedKeywords.join('\n'))}

rebuild-issue-topics:
  rebuild-issue-topics:${issueId}:${contentHash ?? 'no-hash'}

aggregate-topic-slice:
  aggregate-topic-slice:${sha256(sortedKeywords.join('\n'))}
```

Planner runs may create a new run-scoped job, but active jobs with the same semantic key should be deduplicated while they are `queued`, `processing`, or `deferred`.

## D1 coordination model

Add queue-oriented tables without changing public read tables.

### `pipeline_runs`

Purpose: one row per admin/cron/planner operation.

```sql
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'running',
  notes        TEXT
);
```

Terminal statuses:

- `completed`
- `partial`
- `failed`

### `pipeline_jobs`

Purpose: one row per queued unit of work.

```sql
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  schema_version    INTEGER NOT NULL,
  kind              TEXT NOT NULL,
  semantic_key      TEXT NOT NULL,
  status            TEXT NOT NULL,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  payload_json      TEXT NOT NULL,
  result_json       TEXT,
  last_error        TEXT,
  last_error_kind   TEXT,
  last_error_stage  TEXT,
  rate_limited_until TEXT,
  queued_at         TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_pipeline_jobs_run_status
  ON pipeline_jobs(run_id, status);

CREATE INDEX idx_pipeline_jobs_semantic_active
  ON pipeline_jobs(semantic_key, status);
```

Job statuses:

- `queued`
- `processing`
- `succeeded`
- `failed`
- `deferred`
- `cancelled`

### `pipeline_phases`

Purpose: run-level progress by named phase.

```sql
CREATE TABLE IF NOT EXISTS pipeline_phases (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  phase        TEXT NOT NULL,
  status       TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  error_count  INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT
);
```

Useful phases for Flux:

- `plan`
- `issue_topic_rebuild`
- `corpus_aggregate`
- `topic_embedding`
- `similarity_finalize`

## Planner behavior

Cron/admin routes become planners.

Planner steps:

1. Create `pipeline_run`.
2. Acquire planner lock or detect an active run.
3. Re-enqueue due deferred jobs first.
4. Decide fresh work:
   - new/updated issues since last run
   - topics needing embeddings
   - corpus topic slices needing re-aggregation
5. Insert `pipeline_jobs` with deterministic semantic keys.
6. Send messages via `sendBatch()`.
7. Record `pipeline_phases` and wide planner event.
8. Return quickly for admin routes; cron exits after planning and any required inline ingestion.

Planner should skip fresh work if backlog exceeds a Flux threshold, for example:

```txt
active enrichment jobs > 500
or oldest deferred job age > 48h
```

## Consumer behavior

Consumer pseudocode:

```ts
export default {
  async queue(batch, env): Promise<void> {
    for (const msg of batch.messages) {
      const start = Date.now();
      try {
        const job = await claimJob(env.DB, msg.body.jobId, msg.attempts);
        if (!job) {
          msg.ack();
          continue;
        }

        const result = await handleMessage(env, msg.body, job);
        await markJobSucceeded(env.DB, job.id, result);
        logWideQueueEvent({ status: 'succeeded', attempts: msg.attempts, elapsed_ms: Date.now() - start });
        msg.ack();
      } catch (err) {
        if (isRateLimit(err)) {
          await markJobDeferred(...);
          msg.ack();
        } else if (shouldRetryError(err)) {
          await markJobRetryableFailure(...);
          msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
        } else {
          await markJobFailed(...);
          msg.ack();
        }
      }
    }
  }
}
```

Rules:

- Never throw the whole batch for one bad message.
- Prefer per-message `ack()` / `retry()`.
- Include `message.attempts` in job state and logs.
- ACK malformed or unsupported messages after marking the durable job failed.
- Retry only transient errors.
- Persist deferred/rate-limit state before ACKing.

## Retry, defer, and DLQ policy

### Retryable

Retry with `delaySeconds`:

- D1 transient lock / `SQLITE_BUSY`
- Workers AI 429/503
- Vectorize 429/503
- network timeouts
- temporary platform errors

### Deferred

Persist `deferred` and ACK:

- explicit rate limit with a known retry-after time
- backlog guard says not now
- dependent data not ready but expected later

### Permanent failure

Mark `failed` and ACK:

- invalid schema version
- unsupported message kind
- missing required issue/topic rows where the job cannot succeed
- deterministic validation errors

### DLQ

Messages that exhaust `max_retries` should land in `flux-topic-embed-dlq`. Operator tooling should preserve enough job state to replay:

- original payload
- run ID
- job ID
- correlation ID
- semantic key
- attempt count
- last error
- last failing stage

## Operator routes

Protected admin routes should answer operational questions without log spelunking.

Add or keep:

```txt
GET  /admin/pipeline-runs
GET  /admin/pipeline-runs/:id
GET  /admin/pipeline-runs/:id/jobs
GET  /admin/pipeline-jobs/:id
GET  /admin/topic-audit
POST /admin/rebuild-topics
POST /admin/pipeline-jobs/:id/replay
POST /admin/queue/dlq/:jobId/replay
```

Required operator questions:

1. Did planning fail before enqueueing work?
2. Which topic jobs were enqueued?
3. Which jobs are processing/succeeded/failed/deferred?
4. Which stage failed?
5. How many attempts happened?
6. Which jobs exhausted retries?
7. Which deferred jobs are due?
8. Is the DLQ empty?
9. Did public search/topic responses change after the queue run?

## Observability model

Use wide events: one log line per planner run and one per queue job.

Common fields:

```json
{
  "event": "topic_enrichment_job",
  "run_id": "...",
  "job_id": "...",
  "correlation_id": "...",
  "kind": "embed-corpus-topics",
  "status": "succeeded",
  "attempts": 1,
  "batch_size": 25,
  "elapsed_ms": 1234,
  "error_kind": null,
  "error_message": null
}
```

Avoid low-context helper logs as the primary diagnostic surface.

## Public behavior contract

Queue migration must not change:

- `/search` response shape
- all three `/search` paths: normal, filter-only, issue lookup
- `/issues/:id` shape except additive fields already documented
- `/issues/issue/:number/sections`
- `/latest-issue`
- `/topics` sorting semantics unless explicitly approved
- static frontend routes

Topic rebuilds may update topic freshness, but queue-backed and inline rebuilds should produce equivalent D1 read state for the same fixture corpus.

## Rollout plan

### Phase 0 — Spec and baseline

- Land this spec.
- Capture current inline topic rebuild output:
  - issue topic counts
  - corpus topic count/order
  - topic timeline row count
  - topic similarity count
  - representative `/search`, `/topics`, `/issues/...` payloads
- Add fixtures for queue message schemas.

### Phase 1 — Harden current queue seam

- Add `schemaVersion`, `jobId`, `correlationId`, `queuedAt`.
- Add `pipeline_jobs` and `pipeline_phases`.
- Make queue jobs claim/update durable rows.
- Await queue message processing directly.
- Include `message.attempts` in logs/state.
- Add duplicate-message tests.

### Phase 2 — Queue topic embeddings for real

- Planner enqueues `embed-corpus-topics` batches after corpus aggregation.
- Consumer performs embedding work and writes similarity/cross-validation output.
- Inline path remains as fallback.
- DLQ inspection route exists.

### Phase 3 — Queue per-issue topic rebuilds

- New or changed issues enqueue `rebuild-issue-topics` jobs.
- Consumer uses content hash to skip unchanged work.
- Aggregate/finalize phase runs after jobs complete or on next planner pass.

### Phase 4 — Queue-backed default

Make queue-backed rebuild the default only after:

- 3 consecutive successful weekly topic queue runs
- DLQ remains empty or replay succeeds
- public response comparison passes
- no deferred job older than 48 hours
- operator routes answer the required questions

### Phase 5 — Remove inline fallback

Only after:

- 10 consecutive successful queue-backed topic runs
- two successful full backfills
- public output remains equivalent
- DLQ replay has been demonstrated
- rollback plan is documented

## Testing strategy

### Unit tests

- message schema validation
- message fan-out batching
- retry/defer classification
- idempotency key generation
- wide-event construction

### PBT

- duplicate messages never produce duplicate active durable jobs
- batching preserves every keyword exactly once
- repeated transient retries do not mutate successful output twice
- run status derived from job statuses is deterministic

### D1 integration tests

- planner inserts run/jobs/phases
- consumer claims one job and marks succeeded
- duplicate delivery resolves to same job
- transient error increments attempt and retries
- permanent error marks failed and ACKs
- deferred job is re-enqueued before fresh work

### Public behavior tests

For the same fixture corpus, compare inline and queue-backed outputs:

```txt
reports/queue-migration/inline/search/*.json
reports/queue-migration/queue/search/*.json
reports/queue-migration/inline/topics/*.json
reports/queue-migration/queue/topics/*.json
reports/queue-migration/inline/issues/*.json
reports/queue-migration/queue/issues/*.json
```

Suggested commands to add:

```bash
npm run characterize:topics:inline
npm run characterize:topics:queue
npm run compare:queue-public-surfaces
npm run smoke:queue-local
npm run smoke:operator-routes
```

## Metrics we expect to improve

Baseline values must be captured before changing the default execution path. Targets are initial guardrails; tune after three real weekly runs.

| Metric | Baseline source | Target | Verification mechanism | Why queues help |
| --- | --- | --- | --- | --- |
| `/admin/rebuild-topics` response p95 | wrangler tail + admin smoke timing before queue default | `< 2s` for planner response | `npm run smoke:operator-routes`; record HTTP timing for 20 admin calls | route plans/enqueues instead of doing the rebuild inline |
| Topic rebuild end-to-end wall time p95 | current `topic_rebuild` wide event `elapsed_ms` | `>= 30%` lower after queue-backed default, or no regression if corpus grows | compare `pipeline_runs` and wide events over 3 weekly runs | slow phases fan out into bounded batches |
| Weekly cron wall time p95 | current `weekly_sync_complete.elapsed_ms` | `< 30s` when no new issues; no timeout when new issues exist | cron log query + `crawl_runs`/`pipeline_runs` timestamps | cron plans enrichment instead of owning all follow-up work |
| Failed topic-run rate | historical `pipeline_runs.status` once table exists; before that, logs | `< 1%` failed runs over trailing 30 days | `GET /admin/pipeline-runs?limit=100` and count failed topic runs | failures isolate to jobs instead of whole rebuilds |
| Single bad issue/topic blast radius | fixture that forces one issue/topic failure | one `pipeline_job` failed; run status at worst `partial` | D1 integration test: one poison job plus two good jobs | per-message ack/retry prevents batch/run failure |
| Transient recovery rate | retry fixture + production job history | `> 95%` of retryable failures eventually succeed before DLQ | query `pipeline_jobs` where `attempt_count > 1` grouped by terminal status | queue retries with backoff recover platform/API blips |
| DLQ unresolved age | DLQ/operator route | no unresolved DLQ job older than `48h` | `GET /admin/queue/dlq` or replay smoke once implemented | exhausted retries are visible and replayable |
| Duplicate processing inconsistency rate | duplicate delivery PBT/integration fixture | `0` inconsistent D1 writes | PBT/idempotency test: duplicate messages resolve to one active semantic job | semantic idempotency keys absorb at-least-once delivery |
| Queue job p95 runtime | `topic_enrichment_job.elapsed_ms` | `< 10s` per `embed-corpus-topics` batch at batch size 25 | wide-event aggregation over queue logs | bounded batch sizes avoid long invocations |
| Topic freshness after ingest | latest issue `ingested_at` vs first available `issue_topics`/`corpus_topics.updated_at` | issue topics available immediately after ingest; corpus topics within one cron/planner cycle | D1 query in smoke: latest active issue has topics; corpus `updated_at >= ingested_at` after planner | post-ingest follow-up is explicit queued work |
| Public response drift | fixture public payload snapshots | `0` unapproved diff | `npm run compare:queue-public-surfaces` | queues change execution, not read contracts |

## Verification mechanisms

### Metrics capture queries

Add scripts or admin routes that can answer these without manual log spelunking.

#### Pipeline run summary

```sql
SELECT
  mode,
  status,
  COUNT(*) AS runs,
  AVG(strftime('%s', completed_at) - strftime('%s', started_at)) AS avg_seconds,
  MAX(strftime('%s', completed_at) - strftime('%s', started_at)) AS max_seconds
FROM pipeline_runs
WHERE started_at >= datetime('now', '-30 days')
GROUP BY mode, status;
```

#### Job terminal status and retry recovery

```sql
SELECT
  kind,
  status,
  COUNT(*) AS jobs,
  SUM(CASE WHEN attempt_count > 1 THEN 1 ELSE 0 END) AS retried_jobs
FROM pipeline_jobs
WHERE queued_at >= datetime('now', '-30 days')
GROUP BY kind, status;
```

#### Old deferred/failed jobs

```sql
SELECT id, kind, status, attempt_count, last_error, updated_at
FROM pipeline_jobs
WHERE status IN ('deferred', 'failed')
  AND updated_at < datetime('now', '-48 hours')
ORDER BY updated_at ASC;
```

#### Topic freshness after latest ingest

```sql
SELECT i.id, i.issue_number, i.ingested_at, COUNT(t.keyword) AS topic_count
FROM issues i
LEFT JOIN issue_topics t ON t.issue_id = i.id
WHERE i.status = 'active'
  AND i.issue_number = (SELECT MAX(issue_number) FROM issues WHERE status = 'active')
GROUP BY i.id;
```

### Required scripts

Add these before queue-backed default:

```bash
npm run characterize:topics:inline
npm run characterize:topics:queue
npm run compare:queue-public-surfaces
npm run smoke:queue-local
npm run smoke:operator-routes
npm run smoke:queue-metrics
```

`smoke:queue-metrics` should fail if:

- any unresolved DLQ/deferred job is older than 48h
- topic-run failed rate over the sampled window is above target
- duplicate semantic keys are active simultaneously
- latest active issue has zero `issue_topics`
- queue job p95 exceeds the target in the available event sample

### Test fixtures

Add fixtures for:

- one successful topic embedding batch
- duplicate `embed-corpus-topics` messages with the same semantic key
- transient Workers AI 429/503 that succeeds on retry
- permanent malformed message schema
- one poison topic batch that fails while neighboring batches succeed
- DLQ replay of a previously failed job

### Production evidence log

For rollout sign-off, store a short report per real run:

```txt
reports/queue-migration/YYYY-MM-DD-topic-run.json
```

Each report should include:

- `pipeline_run.id`
- planner response time
- queue job counts by status/kind
- max and p95 queue job runtime
- retry count and recovery count
- DLQ count and oldest DLQ age
- public response comparison result
- notes for any partial/deferred jobs

## Acceptance criteria

This migration is successful when:

- all metric targets above are met or explicitly waived with evidence
- admin topic rebuild returns quickly after planning
- queue jobs are visible and replayable
- one bad topic batch does not fail the whole run
- transient failures retry with backoff
- permanent failures are isolated and inspectable
- DLQ is configured and testable
- public route payloads remain equivalent for fixture corpora
- weekly cron can rebuild/aggregate topics without exceeding runtime budget

## Remaining backlog migrated from the comparative port plan

These items are intentionally tracked here now so Flux Search has one queue/topic operations roadmap with Flux-native names.

### Operations and reliability

- Audit topic writes and replace `DELETE` + `INSERT` sequences with `INSERT OR IGNORE` / upsert patterns where doing so reduces partial-update windows without breaking replace semantics.
- Extend queue wide events from the initial `embed_batch` seam to every durable queue job phase.
- Expand `pipeline_runs` into full `pipeline_jobs` + `pipeline_phases` before queue-backed default.
- Add DLQ inspection and replay as first-class admin tooling.

### Queue architecture

- Add self-fan-out from consumers only when needed for large topic batches; keep cron/admin as the planner by default.
- Tune queue settings from Flux metrics, not copied defaults: start at `max_batch_size=25`, `max_concurrency=5`, `max_retries=3`, then adjust after measuring D1 contention and Workers AI rate limits.
- Move real topic embedding/similarity work into the queue consumer rather than keeping it as an ack-only seam.
- Hold off on full 18-step finalize decomposition until Flux has enough phases to justify it.

### Search quality and topic scoring

- Add `weightedDeltaScore` for “movers” — topics whose frequency or burst score shifts between periods.
- Promote `distinctiveness` from a column/formula into a focused module if relevance tests show the current simple score is not enough.
- Add a Flux-specific `analysis-text` preprocessing layer if extractor recall on edge inputs remains weak.
- Carry `content_hash` through topic persistence so no-change re-ingests can skip topic extraction and aggregation work.
- Update relevance harnesses to measure topic ranking changes against the existing hand-labeled cases.

### Surfaces and UX

- `/trending` route/page for corpus-level “what is hot recently?” using burst and mover scores.
- Topic marginalia or pull-quotes on `/topics/:keyword` if topic detail pages need better scannability.
- Advanced topic visualizations beyond the current sparkline only after the data layer is stable.
- Shared issue/episode rail component for topic/detail navigation.
- “Matched on topic” hint in result cards when topic boost affects ranking.
- Source-fidelity preservation improvements for rendered issue pages: footnotes, links, and images where normalizer quality permits.

### Developer workflow

- Split Wrangler configuration for local/remote/test if accidental production operations remain a risk.
- Add a local fixture seeding command for topic and queue development.
- Add computed-style browser audits for topic/queue UI surfaces.
- Add pipeline characterization scripts so extraction and queue changes can be compared across runs quickly.

## Immediate implementation checklist

- [ ] Rename current queue message field `type` to `kind` or support both during migration.
- [ ] Add `schemaVersion`, `jobId`, `correlationId`, `queuedAt` to `EnrichmentMessage`.
- [ ] Add `pipeline_jobs` and `pipeline_phases` migration.
- [ ] Record `message.attempts` in consumer logs/state.
- [ ] Change queue handler to await processing directly.
- [ ] Add durable job claim/succeed/fail/defer helpers.
- [ ] Add idempotency-key helper and PBT.
- [ ] Add `/admin/pipeline-runs/:id/jobs`.
- [ ] Add DLQ replay route.
- [ ] Add inline-vs-queue topic characterization scripts.
