# Internal consistency audit

_Last updated: 2026-05-01_

## Scope

Reviewed topic-related docs/specs for consistency with the current implementation:

- `docs/architecture.md`
- `docs/topic-quality-rollout.md`
- `docs/topic-quality-research.md`
- `docs/topic-quality-experiments.md`
- `docs/topic-pipeline.md`
- `docs/topic-operations.md`
- `docs/topic-system-status.md`
- `specs/topic-pipeline-correct-by-construction.spec.md`
- `specs/flux-queues.spec.md`
- `specs/yaket-topics.spec.md`
- `specs/domain-distinctiveness-topics.spec.md`

## Current source of truth

- Canonical current topic pipeline: `docs/topic-pipeline.md`
- Operational playbook: `docs/topic-operations.md`
- Correct-by-construction design/status: `specs/topic-pipeline-correct-by-construction.spec.md`
- Operational rollout script docs: `docs/topic-quality-rollout.md`
- Current production scorecard: `docs/topic-system-status.md`
- Queue architecture: `specs/flux-queues.spec.md`
- Benchmark reports: `reports/correct-by-construction/*.json`

## Consistency findings

### Resolved

1. **Monolithic rebuild vs queue-backed rebuild**
   - Problem: older docs described `POST /admin/rebuild-topics` as a monolithic inline/full backfill route.
   - Current truth: it is queue-backed by default and the monolithic production path is retired.
   - Updated docs/specs to say queue-backed rebuild is the current production path.

2. **`topic_type` status**
   - Problem: earlier notes said `corpus_topics.topic_type` was missing/null.
   - Current truth: aggregation now carries dominant non-unknown issue-topic type into `corpus_topics`; high-impact topics are typed, tail topics can remain `unknown`.
   - Added status and type distribution to `docs/topic-system-status.md`.

3. **`crypto` / `cryptocurrency` policy**
   - Problem: docs said the split was intentional but top-list redundancy remained.
   - Current truth: they remain separate canonical topics, but `cryptocurrency` is demoted in public corpus ranking when both are present.
   - Documented this policy explicitly.

4. **Correct-by-construction result measurement**
   - Problem: design docs described intended metrics but not the latest outcome.
   - Current truth: current system improves average hits@5, minimum hits@5, and gold-set coverage while preserving zero known-bad public topics.
   - Added old-vs-current scorecard.

### Still intentionally true

1. **Some topics remain `unknown`**
   - This is not treated as a bug for ambiguous/low-frequency tail topics.
   - Clear high-impact topics should be typed; ambiguous tail topics may stay unknown until curation has value.

2. **Blocklist still wins**
   - Correct-by-construction reduces bad candidates earlier, but explicit deny/blocklist entries remain authoritative.

3. **Queue rollout gates remain useful**
   - Queue-backed rebuild is now the default, but weekly-run confidence gates still apply before removing older helper/fallback concepts entirely.

## Known documentation caveats

- `docs/topic-quality-research.md` and `docs/topic-quality-experiments.md` are historical research notes. They now include status notes where recommendations have been implemented, but they should not override `docs/topic-pipeline.md`, `docs/topic-system-status.md`, or the current specs.
- `specs/yaket-topics.spec.md` documents the original Yaket topic extraction plan. It now points readers to `docs/topic-pipeline.md` and the queue-backed/correct-by-construction specs for current production behavior.

## Verdict

The docs are now internally consistent around these facts:

1. topic rebuilds are queue-backed;
2. public topic quality improved versus the old baseline;
3. high-impact topics carry `topic_type` metadata;
4. `crypto` and `cryptocurrency` are separate canonical topics with public-rank redundancy control;
5. remaining `unknown` tail topics are an accepted tradeoff, not evidence of pipeline failure.
