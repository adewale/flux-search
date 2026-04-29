# Changelog

## 2026-04-29

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
