# Bobbin Port Plan

Comparative spec capturing what we should port from
[`adewale/bobbin`](https://github.com/adewale/bobbin) into flux-search,
and what we should not. flux-search and Bobbin sit on the same Cloudflare
stack (Workers + Hono + D1 + Vectorize + Workers AI) but Bobbin has been
in production longer and has converged on a queue-driven enrichment
architecture we have not yet adopted.

This spec is the actionable output of a side-by-side audit performed in
this branch. It does not commit us to executing every item; it gives us
a prioritised inventory so that future work can pick a slice with a
clear metric to move.

## Scope

In scope: ideas Bobbin has shipped that we have not. Each entry includes
the metric we expect it to move and a rough effort tag.

Out of scope: ideas already in `claude/yaket-topic-extraction-wbryn`
(provenance tracking, multi-strategy extractor, PMI lexicon, stem-merge
+ Dice clustering, topic boost, topic-similarity table, terminology
drift, burst score, confidence tiers, incremental rebuild, topic
relevance harness, wide event log lines on cron). Those are already
covered in `specs/yaket-topics.spec.md` or shipped on the branch.

## Non-goals

- Re-architecting flux-search to match Bobbin pixel-for-pixel.
- Anything that requires R2 adoption today. flux's raw HTML lives on
  disk in `data/raw/`; moving to R2 has its own design discussion and
  is gated separately.
- Backfilling Bobbin's larger corpus volume. Bobbin handles ~27K raw
  topics → 530 navigational; flux handles ~500 raw → ~120 today. Some
  Bobbin choices are scale-driven and don't apply to us yet.

## Reference points

- `adewale/bobbin/docs/architecture.md` — pipeline phases, queue config,
  finalize step list.
- `adewale/bobbin/src/jobs/queue-handler.ts` — discriminated-union
  message shape, selective retry, self-fan-out.
- `adewale/bobbin/wrangler.jsonc` — `max_batch_size: 50,
  max_concurrency: 20, max_retries: 3`.
- `adewale/bobbin/src/services/topic-quality.ts`,
  `src/services/topic-scoring.ts`, `src/services/distinctiveness.ts`.
- `adewale/bobbin/src/routes/api.tsx` — admin endpoint catalogue.

## Already ported (for context)

These are out of scope for this spec but worth listing so reviewers can
calibrate against what's actually new:

- Multi-strategy extractor with provenance (known entities → phrase
  lexicon → heuristic capitalised → YAKE) — `src/lib/topic-multi-extract.ts`.
- PMI bigram lexicon — `src/lib/pmi-lexicon.ts`.
- Porter stemming + Dice similarity clustering — `src/lib/porter-stem.ts`.
- Topic boost in the hybrid ranker — `src/lib/hybrid-ranker.ts`.
- Topic-quality module with suppression reasons —
  `src/lib/topic-quality.ts`.
- Per-quarter terminology drift — `src/lib/terminology-drift.ts`.
- Burst score + confidence tiers on `corpus_topics` —
  `src/lib/topic-burst.ts`.
- Cosine + Jaccard adjacency — `src/lib/topic-similarity.ts`.
- Incremental rebuild — `rebuildOneIssueTopics` in
  `src/lib/topic-rebuild.ts`.
- Topic-relevance regression sentinel — `test/topic-relevance.test.ts`.
- Wide event log lines on cron + topic_rebuild —
  `src/cron/weekly-sync.ts`, `src/lib/topic-rebuild.ts`.

## What to port — by category

Effort tags: **S** = under a day, **M** = 1–3 days, **L** = a week or
more. Direction is the expected change in the listed metric.

### 1. Operations & reliability

| Item | Effort | Metric → direction |
| --- | --- | --- |
| `runStep(name, fn)` wrapper around each rebuild phase | S | failed-cron-run rate ↓; per-phase timing visibility (new); debug time ↓ |
| `shouldRetryError(err)` matching `SQLITE_BUSY` / 429 / 503 | S | transient retry success ↑; poison-loop count → 0; failed-issue count ↓ |
| `INSERT OR IGNORE` audit across topic ops (replace DELETE+INSERT where safe) | S | partial-update window → 0; retry-safety ↑ |
| `pipeline_runs` audit table (non-crawler ops) | S | time to diagnose regression ↓; historical drift visibility (new) |
| Standalone `topic-audit.ts` job (no state changes — measures only) | S | topic precision sampling (new metric); regression catch rate ↑ |
| DLQ via `dead_letter_queue` config | S (after Queues) | lost-message count → 0; debuggability of dead messages (new) |
| Per-step canonical event log on each queue handler step | S | mean time to detection of slow steps ↓ |

### 2. Pipeline architecture (Cloudflare Queues)

| Item | Effort | Metric → direction |
| --- | --- | --- |
| Single `ENRICHMENT_QUEUE` with discriminated-union messages | M | rebuild p95 ↓; concurrent throughput ↑; D1 contention ↓ at scale |
| `max_batch_size: 50, max_concurrency: 20, max_retries: 3` config | S | throughput ↑; D1 errors bounded by concurrency |
| Self-fan-out via `queue.sendBatch()` from inside the consumer | M | max-work-unit memory ↓; resilience to single-issue failures ↑ |
| `delaySeconds` retry backoff (vs synchronous loops) | S | rate-limit hits ↓; retry success rate ↑ |
| Move topic-embedding pass off `waitUntil` onto a queue | M | `/admin/rebuild-topics` p95 ↓; embed retry success ↑ |
| 18-step finalize decomposition (named, individually retryable) | M | failure granularity ↑; time-budget enforcement (new) |

### 3. Search quality

| Item | Effort | Metric → direction |
| --- | --- | --- |
| `topic-scoring.ts` `weightedTopicScore(count, distinctiveness)` for corpus-topic ranking | S | qualitative ranking ↑ on `/topics?sort=*`; distinctiveness becomes a first-class column |
| `weightedDeltaScore` for "movers" (topics that shifted between periods) | S | enables a "movers" sort and a richer trending surface |
| Cosine top-K=15 + `<0.72` floor in `searchVectorize` | S | semantic noise on long-tail queries ↓; Vectorize spend ↓ |
| `distinctiveness.ts` corpus-aware uniqueness scoring | M | topic precision ↑; relevance harness pass rate ↑ |
| `analysis-text.ts` text preprocessing (assumed tighter than ours) | M | extractor recall on edge inputs ↑ (qualitative) |
| Carry `content_hash` dedup through to topic ingest path | S | duplicate-processing rate ↓; cron runtime on no-change runs ↓ |

### 4. Surfaces & UX

| Item | Effort | Metric → direction |
| --- | --- | --- |
| `/trending` route — corpus-level "what's hot in the last N quarters" | M | landing engagement ↑ (qualitative); discovery depth ↑ |
| `topic-marginalia.tsx` — annotations / pull-quotes on topic page | M | scannability ↑; bounce on `/topics/:keyword` ↓ |
| `topic-advanced-viz` — additional charts beyond the sparkline | L | repeat-visit rate ↑ (qualitative); time-on-page ↑ |
| `episode-rail.ts` as a shared component reused across routes | M | navigation latency ↓; back-to-issue clicks ↑ |
| "Matched on topic" hint in result-card UI | S | user trust in ranking ↑ (qualitative); time to diagnose ranking ↓ |
| Source-fidelity preservation (footnotes, links, images through normalizer) | M | bounce-to-Substack ↓ (in-app rendering closer to source) |

### 5. Developer workflow

| Item | Effort | Metric → direction |
| --- | --- | --- |
| Wrangler env split — `wrangler.local.jsonc` / `.remote.jsonc` / `.test.jsonc` | S | accidental prod ops from local → 0; config drift visibility ↑ |
| Real migration files used uniformly across local/test/prod | S | schema-skew bugs → 0; CI/dev parity ↑ |
| `npm run fixture:local` style local seeding | M | local dev setup time ↓; PR review confidence ↑ |
| Computed-style browser audit (Playwright over resolved CSS values) | M | visual regression catch rate ↑; CSS drift caught in CI |
| `pipeline-characterization.ts` baseline for cross-run regression | M | regression catch rate ↑; "did the last change make extraction worse?" answerable in seconds |

## Recommended sequencing

Three blocks in order. Each block lands behind its own commit so we can
measure before moving on.

### Block A — Operations bundle (S, immediate payoff)

Goal: light up observability gaps and stop one bad issue from killing
a rebuild.

1. `runStep(name, fn)` wrapper around every phase in `rebuildAllTopics`.
2. `shouldRetryError(err)` with the canonical pattern set
   (`SQLITE_BUSY`, `429`, `503`, network blips).
3. `pipeline_runs` table + admin endpoint that lists the last N runs
   with per-step timing.
4. Standalone `topic-audit` admin endpoint that samples 20 issues, runs
   the extractor, and reports precision deltas vs the stored topics.
5. `INSERT OR IGNORE` audit pass over `topic-queries.ts`.

Success criteria: a single bad issue reports its phase + error in the
log, the run continues, and the next run picks up where the failure
happened. `pipeline_runs` shows historical timing so we can spot the
first day a phase regressed.

### Block B — Search-quality micro-port (S–M)

Goal: move the relevance harness without touching the pipeline shape.

1. Port `topic-scoring.ts` weighted score functions and add a
   `distinctiveness` column to `corpus_topics`.
2. Add cosine top-K=15 + `<0.72` floor inside `searchVectorize`.
3. Carry `content_hash` dedup through `persistIssueTopics` so
   no-change re-ingests are no-ops.
4. Update the relevance harness to assert the new ranking holds
   against the 13 hand-labelled cases.

Success criteria: relevance harness pass rate stays at 13/13 or
improves; Vectorize call count on long-tail queries drops measurably;
cron runtime on a no-change refresh drops below 1s.

### Block C — Queues, narrowly (M)

Goal: prove the queue pattern on the slowest phase only — topic
embedding — without committing to the whole topology.

1. Add `ENRICHMENT_QUEUE` binding with one consumer.
2. Define a discriminated-union `EnrichmentMessage` with one initial
   variant: `embed-corpus-topics`.
3. Move the embedding pass in `rebuildAllTopics` from inline
   `waitUntil` to a fan-out via `queue.sendBatch()`. Each batch
   embeds 25 topics and writes the cosine-blended pairs.
4. Configure `max_batch_size: 25, max_concurrency: 5, max_retries: 3,
   dead_letter_queue: "flux-topic-embed-dlq"`.
5. Adopt `delaySeconds: 5` retry on transient errors; ack everything
   else after `shouldRetryError` returns false.
6. Per-message canonical event line: `{ event: "embed_batch",
   batch_size, elapsed_ms, retried, ack }`.

Success criteria: `/admin/rebuild-topics` returns within 2s instead of
blocking on the embed pass; no embedding-driven 429s reach the foreground
path; DLQ stays empty under nominal load.

## Things to hold

- Full 18-step finalize decomposition. We have ~7 phases now; expanding
  to 18 is a Bobbin-scale problem we don't have yet.
- Large UX surfaces (`/trending`, advanced viz, marginalia). Worth
  doing once the data layer settles, not before.

## Things to actively not port

- Bobbin's binary early/late terminology drift. Our per-quarter
  bucketed `computeTerminologyDrift` is strictly more informative.
- Bobbin's adjacent-topics-by-ranking-volume. Bobbin's own
  `topics.tsx` describes this as "ranking neighbors, not semantic
  neighbors." Our cosine + Jaccard blend in `topic-similarity.ts` is
  the better default.

## Open questions

- **DLQ shape.** Bobbin doesn't appear to configure one in
  `wrangler.jsonc`. Do we want a per-queue DLQ from day one, or a
  single global DLQ keyed by message type? Day-one is safer.
- **Cost of `max_concurrency: 20`.** Paid-plan-only and unbounded
  enough to surprise us at the next billing cycle. Recommend starting
  at 5 and tuning up after we measure D1 contention.
- **Local queue testing.** Cloudflare's docs are thin on this. We may
  need to stub the queue binding entirely in vitest and rely on
  `wrangler dev` for end-to-end validation. Worth a short spike before
  Block C.
