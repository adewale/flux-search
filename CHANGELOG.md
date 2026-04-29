# Changelog

## 2026-04-29

### Added

- Improved topic quality:
  - suppresses editorial boilerplate topics including `signposts clues` and `editor note`
  - suppresses generic singleton navigation noise such as `people`, `world`, `time`, `move`, `point`, and `direction`
  - boosts meaningful multi-word phrases in corpus-topic ranking
  - adds a topic-quality blocklist migration (`0013_topic_quality_blocklist.sql`)
  - adds deployed smoke tests for topic-quality regressions
- Expanded `/admin/topic-audit` with suspicious corpus-topic diagnostics.

### Changed

- Reaggregated production topic tables after applying the quality blocklist; `/topics/signposts%20clues` and `/topics/editor%20note` now return 404.

### Verified

- `npm test` → 854 passing tests.
- `npm run typecheck` → passed.
- Remote D1 migration `0013_topic_quality_blocklist.sql` applied.
- Deployed Worker version `938620da-474a-4a5f-a12e-2998889bd8d6`.

---

### Added

- Added Flux-native topic enrichment queue durability:
  - versioned `EnrichmentMessage` contract with `kind`, `schemaVersion`, `jobId`, `correlationId`, and `queuedAt`
  - legacy `type` / `run_id` compatibility during migration
  - durable `pipeline_jobs` and `pipeline_phases` tables
  - idempotency-key helper with property-based tests
  - queue job claim/succeed/fail/defer helpers
  - `/admin/pipeline-runs/:id/jobs` for inspecting queued work
  - `/admin/dlq/replay` for replaying dead-letter messages
  - `npm run metrics:topic-queue` smoke/characterization script
- Added related issue rendering to the issue-page topic UI:
  - desktop: related issues appear below topics in the sticky side panel
  - mobile: `Topics (N)` and `Related issues` render as separate details blocks
- Added API support for `related_issues` on issue JSON responses.
- Added migration `0011_pipeline_jobs.sql`.

### Changed

- Queue consumer now awaits enrichment processing directly rather than detaching it through `waitUntil`.
- Updated Yaket topic spec to current `@ade_oshineye/yaket@0.5.3`.
- Archived the comparative Bobbin port plan as a pointer and moved active queue backlog into `specs/flux-queues.spec.md`.

### Fixed

- Fixed an opening-quote normalizer edge case where property-based tests found cleaned quotes could still start with `>`.
- Made the live semantic threshold test tolerate temporary empty Vectorize results while still checking co-match invariants when semantic rows are present.

### Verified

- `npm test` → 845 passing tests.
- `npm run typecheck` → passed.
- Remote D1 migration `0011_pipeline_jobs.sql` applied.
- Deployed Worker version `b537d6c9-370e-4a74-a164-848384e117d9`.
