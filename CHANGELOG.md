# Changelog

## 2026-07-19

### Fixed

- User typing during cold start now cancels the pending latest-issue transition, so a late response cannot overwrite draft input.
- Older search and autocomplete responses can no longer replace newer results or reopen stale suggestions; pagination honors initial page URLs and same-query history navigation.
- The clear button keeps a continuous 44×44 interaction target by animating only its icon; mobile browser tests now emulate touch capabilities instead of viewport size alone.
- Playwright journeys now wait for observable UI states instead of fixed sleeps or cold-start races.
- Visual regression tests use committed API fixtures, refreshed desktop/mobile baselines, and no longer carry orphaned landing snapshots.

### Verified

- `npm test` → 967 passing tests (90 files).
- `npm run typecheck` → passed.
- Playwright against the Cloudflare version preview → 59 passed, 3 intentionally skipped.

## 2026-06-12

### Added

- Added `test/response-contract.test.ts`: route-level contract tests (real SQLite + FTS5 via `node:sqlite`) pinning the 7 top-level response fields, the 10 result fields, and the `parsed_query` shape across all three search paths.
- Added `test/corpus-helpers.ts`: tests process `data/raw/` through the production crawl + normalize pipeline instead of reading the generated `data/processed/` directory — `npm test` now passes on a fresh clone (the issue-topic gold suite previously failed to collect without `npm run corpus:process`).
- Added `test/frontend-utils.test.ts` and `test/css-tokens.test.ts`: unit + property-based coverage for the shared frontend string utilities, plus source-level contracts for the design-token rules in CLAUDE.md (single `.chip` definition, radius/tracking tokens, breakpoint allowlist, no unused tokens).
- Added timezone-independence tests for derived `year`/`month` (reproduce with `TZ=America/New_York`).
- Added `PLAYWRIGHT_BASE_URL` override so e2e tests can target a local dev server instead of production.

### Changed

- `issue:N` combined with other operators (e.g. `issue:5 section:lens`) now routes through the filter path so every operator listed in `applied_filters` is actually applied; `issue:N` alone still short-circuits with high confidence.
- `parsed_query` now has the same `{free_text, phrases, filters}` shape on every search path (the issue-lookup path previously leaked the internal camelCase `ParsedQuery`).
- `parseSections` classifies only the FIRST unknown `##` heading as `lead_essay`; later one-off headings become `other` (matches the documented contract).
- `escapeHtml` in `frontend/js/lib/utils.js` is now a pure string function (no DOM), escapes quotes, and is the single shared implementation — local copies in `topic-render.js` and `topics-page.js` removed; `scripts/process-corpus.ts` now imports the HTML→markdown converter from `crawl-client` instead of carrying a diverged copy.
- Issue page now escapes section titles, gates CDN `marked` rendering behind DOMPurify sanitization, and the built-in markdown converter only links http(s)/relative/fragment URLs.
- Normalizer derives `year`/`month` from the `published_at` string instead of local-timezone Date getters.
- CSS: removed the dead duplicate `.chip` rule, replaced raw `border-radius` values with tokens, removed the unused `--shadow` token.

### Fixed

- Documentation drift found by a codebase audit: result objects have 10 fields (including `topics`); the boost table now lists the topic-match boost (+1.5); the rate-limiter binding, `topic:` operator, `other` section type, all five state-machine states, and the `/latest-issue`, `/random-quote`, `/issues/issue/:number/sections` routes are documented; CHANGELOG entries backfilled below.

### Verified

- `npm test` → 962 passing tests (89 files, 0 skipped) on a fresh clone.
- `npm run typecheck` → passed.

## 2026-06-05

### Added

- Added a Workers Rate Limiting binding (`SEARCH_RATE_LIMITER`, 60/min per IP) guarding metered semantic text searches; over-limit requests get `429 {"error":"rate_limited"}`.
- Added Vectorize metadata-index bootstrap script (`npm run vectorize:metadata-indexes`) enabling pre-topK filtering for date/section/topic-constrained semantic queries.
- Added Dependabot config and `npm audit` to CI.

### Changed

- Hardened the topic rebuild queue: enrichment consumer claims, retries, and defers jobs more conservatively; vector search applies metadata filters server-side.

## 2026-05-01

### Changed

- CI generates the processed corpus (`npm run corpus:process`) before running tests.
- Updated topic system docs, internal consistency audit, topic rebuild lessons, and added canonical topic pipeline docs (2026-05-02).

## 2026-04-30

### Added

- Added correct-by-construction topic boundary: `CleanText`, `TopicRegistry`, and `constructCandidate()`.
- Added queue-backed topic rebuilds with `topic-extract-batch` and `topic-finalize-rebuild` jobs.
- Added topic-quality rollout and benchmark reports under `reports/correct-by-construction/`.
- Added current topic system status and internal consistency audit docs.
- Added canonical topic pipeline and topic operations docs.

### Changed

- `POST /admin/rebuild-topics` is now queue-backed instead of monolithic.
- `corpus_topics` now carries `topic_type`, `quality_status`, and `eligibility_status` from constructed issue candidates.
- `crypto` and `cryptocurrency` remain separate canonical topics, but `cryptocurrency` is demoted in public ranking when both are present.

### Verified

- Current public corpus topics: 134.
- Correct-by-construction scorecard improved from old baseline: average hits@5 `2.64 → 3.40`, minimum hits@5 `0 → 2`, issues with ≥3 hits@5 `15/25 → 21/25`, issues with ≥4 hits@5 `5/25 → 12/25`.
- Known bad/artifact public topics remain at 0.
- `npm test` → 918 passing tests.
- `npm run typecheck` → passed.
- Deployed Worker version `711ecd04-f3f4-4ccd-ba24-778060026bbb`.

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

## 2026-04-29 (earlier)

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
