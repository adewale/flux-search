# Documentation Brittleness Audit

Audit date: 2026-04-12. Covers all 9 documentation files in the project.

---

## 1. Contradictions Between Documents

These are cases where one document says X and another says Y.

| # | Claim A | Claim B | Severity |
|---|---------|---------|----------|
| C1 | **CLAUDE.md line 5**: "230 numbered issues" | **README.md line 3**, **architecture.md line 5**, **flux.spec.md line 7**, **search.md line 7**, etc.: "234 issues" | **High** — CLAUDE.md is the AI-assistant guidance file; giving it a wrong issue count is actively misleading. Fix: use "234" everywhere, or better yet, remove the count entirely and say "all issues." |
| C2 | **architecture.md line 5**, **flux.spec.md line 7**: "2012-2026" | **README.md line 3**, **CLAUDE.md line 5**, **search.md line 7**: "2021-2026" | **High** — The newsletter started in May 2021, not 2012. "2012" appears in two files and is simply wrong. |
| C3 | **CLAUDE.md line 71**: "618 unit/PBT/corpus tests" | **CLAUDE.md line 77**: "npm test # 470+ tests" | **High** — The same file contradicts itself four lines from the comment block. Actual count today: 618 across 44 files. "470+" is stale from an earlier era. |
| C4 | **flux.spec.md line 156**: "189 tests across 14 files" | **architecture.md line 218**: "618 tests across 44 files" | **High** — The spec was frozen at a point-in-time snapshot. The architecture doc has the current count. Both will drift. |
| C5 | **lessons-learned.md line 75**: "Our 120 unit tests" / **line 117**: "0 to 173 tests" | **architecture.md line 218**: "618 tests across 44 files" | **Low** — Lessons-learned is a narrative that describes historical states. The numbers are correct in context but could confuse a reader who expects them to be current. |
| C6 | **lessons-learned.md line 45, 73, 81, 164**: "233 issues" / "233 URLs" | **README.md**, **architecture.md**, etc.: "234 issues" | **Medium** — Lessons-learned snapshots a historical moment (before the 234th issue was added). But a reader skimming may not realize these are different timestamps. |

---

## 2. Hardcoded Numbers (Ticking Clocks)

Every hardcoded count will go stale the moment the project evolves. Sorted by how fast they'll drift.

| # | File | Line/Section | Fragile text | Staleness speed | Recommendation |
|---|------|-------------|--------------|-----------------|----------------|
| N1 | README.md | 3 | `234 issues from 2021-2026` | **Weeks** — next issue makes it 235; next year makes range wrong | Remove count. Say "all issues of The FLUX Review." Date range could be "2021-present." |
| N2 | README.md | 74 | `1,401 checks across 234 records` | **Weeks** — any new issue or new validation rule changes both numbers | Say "runs validation checks across all corpus records" |
| N3 | README.md | 81 | `run 618 tests` | **Days** — any new test changes this | Say "run tests" or "run the test suite" |
| N4 | CLAUDE.md | 5 | `230 numbered issues (2021-2026)` | **Already stale** — actual count is 234 | Remove count or say "all numbered issues" |
| N5 | CLAUDE.md | 71 | `618 unit/PBT/corpus tests` | **Days** | Remove count. Say "Run `npx vitest run` for unit/PBT/corpus tests." |
| N6 | CLAUDE.md | 77 | `470+ tests` | **Already stale** — actual count is 618 | Remove count |
| N7 | CLAUDE.md | 80 | `1,401 checks across 234 records` | **Weeks** | Same as N2 |
| N8 | architecture.md | 5 | `234 issues from 2012-2026` | **Weeks** (count) + **Already wrong** (2012) | Remove count and fix date range |
| N9 | architecture.md | 21 | `7,773 vectors` | **Weeks** — changes with any re-chunk or new issue | Say "~N vectors" or remove; the count is already in the Vectorize dashboard |
| N10 | architecture.md | 165 | `23 columns` | **Months** — any migration changes this | Remove the count. List the notable columns without counting them. |
| N11 | architecture.md | 180 | `~7,773 (234 issues × ~33 chunks average)` | **Weeks** | Say "one vector per chunk, typically 30-35 chunks per issue" — the ratio is more durable than the product |
| N12 | architecture.md | 218 | `618 tests across 44 files` | **Days** | Remove counts |
| N13 | architecture.md | 224 | `13 hand-labeled {query → expected result} cases` | **Months** | Say "hand-labeled evaluation set" without the count |
| N14 | architecture.md | 225 | `12 Playwright screenshot comparisons (6 pages × 2 viewports)` | **Months** | Say "Playwright visual regression tests across multiple pages and viewports" |
| N15 | search.md | 7 | `234 newsletter issues spanning 2021-2026` | **Weeks** | Same fix as N1 |
| N16 | search.md | 80 | `~7,800 vectors` | **Weeks** | Remove or say "a few thousand vectors" |
| N17 | search.md | 243 | `77 tests across 8 categories` | **Days** | Remove count |
| N18 | flux.spec.md | 7 | `234 issues (2012–2026)` | **Already wrong** (2012) + **Weeks** (count) | Fix to 2021 and remove count |
| N19 | flux.spec.md | 34 | `234 issues since May 2021` | **Weeks** | "publishes weekly since May 2021" — describes the cadence, not the count |
| N20 | flux.spec.md | 156 | `189 tests across 14 files` | **Already stale** — now 618 across 44 | Remove or mark as "at time of writing" |
| N21 | density-strip.spec.md | 44 | `enforced by 21 tests` | **Months** | Say "enforced by geometric relationship tests" |
| N22 | density-strip.spec.md | 126 | `21 geometric relationship tests` | **Months** | Same as N21 |
| N23 | lessons-learned.md | 240 | `24 boilerplate patterns × 234 issues = 5,616 assertions` | **Weeks** | Narrative is fine, but the multiplication is fragile. Could say "thousands of assertions across all raw HTML files" |
| N24 | density-strip-research.md | 32 | `~234 issues` | **Weeks** | Say "a few hundred issues" — the research doc's point doesn't depend on the exact count |
| N25 | CLAUDE.md | 32 | `~30 cleaning regexes` | **Months** | "Many cleaning regexes" or just "The cleaning regexes have ordering dependencies" |
| N26 | TODO.md | 1-5 | `4 non-issue posts in D1` | **Months** — may be fixed or count may change | Fine for TODO — expected to be transient |
| N27 | density-strip.spec.md | 84 | `576px (SVG viewBox units)` / `80px` / `AXIS_W: 2px` / `16px` / `12px` | **Months** — any layout tweak invalidates these | These are in a spec that mirrors code. See "Over-specified details" section below. |

---

## 3. Fragile References (Exact Paths, Signatures, Constants)

| # | File | Line/Section | Fragile text | Why it's fragile | Recommendation |
|---|------|-------------|--------------|------------------|----------------|
| F1 | CLAUDE.md | 19 | `src/routes/search.ts` in heading | File rename breaks the reference | Fine — this is a navigation aid. Just keep it updated if renamed. |
| F2 | CLAUDE.md | 28 | "same 7 top-level fields and 9 result fields" | Adding a field to the API response makes this wrong | Say "the same response shape" and link to the contract definition in architecture.md |
| F3 | CLAUDE.md | 31 | `src/lib/normalizer.ts` in heading | File rename breaks reference | Same as F1 — acceptable. |
| F4 | CLAUDE.md | 39 | `frontend/js/lib/search-state.js` in heading | File rename breaks reference | Same as F1. |
| F5 | CLAUDE.md | 50 | `src/lib/sections.ts` in heading | File rename breaks reference | Same as F1. |
| F6 | CLAUDE.md | 56 | `text.replace(/[^\w\s-]/g, ' ')` — exact regex | If the sanitization regex changes, this line becomes a lie | Say "User input is sanitized to word characters, spaces, and hyphens before FTS5 MATCH" — describe the policy, not the implementation |
| F7 | CLAUDE.md | 59 | `e2e/density-alignment.spec.ts` in heading | File rename breaks reference | Same as F1. |
| F8 | architecture.md | 122-126 | Exact list of 7 top-level fields and 9 result fields | Adding or renaming any field makes this wrong | Keep the contract, but note "see the TypeScript types for the canonical list" |
| F9 | architecture.md | 131-148 | Full module map with file paths and descriptions | Any file add/rename/delete makes this section stale | This is valuable as a map. Add a note: "Run `ls src/` to verify against the current codebase." |
| F10 | architecture.md | 153-157 | Frontend file list — lists `app.js`, `autocomplete.js`, `result-list.js`, `utils.js` | **Already incomplete** — missing `density.js`, `search-state.js`, `search-state.d.ts`, `section-labels.js`, `issue-page.js` | Update the list, or say "see `frontend/js/lib/` for all modules" |
| F11 | architecture.md | 172-174 | BM25 field weights as a code block: `title: 16 | subtitle: 8 | ...` | If weights are tuned in SQL, this becomes wrong | Reference the migration file or FTS5 table definition as the source of truth |
| F12 | architecture.md | 196-207 | Full boost table with exact values (+10.0, +6.0, etc.) | Duplicates the BOOSTS constant in `hybrid-ranker.ts`. Any tune breaks the doc. | Keep the table but add: "Source of truth: `BOOSTS` in `src/lib/hybrid-ranker.ts`" |
| F13 | search.md | 26-27 | `bm25(issues_fts, 16.0, 8.0, 8.0, 4.0, 1.0, 2.0)` — exact SQL | Any weight change makes this wrong | Same as F11 |
| F14 | search.md | 44-45 | `snippet(issues_fts, 4, '<mark>', '</mark>', '...', 24)` — exact SQL | Column index change or snippet config change breaks this | Describe the behavior ("extracts context around matches, wraps in mark tags") instead of pasting SQL |
| F15 | search.md | 91-92 | `lexical_weight = 1.0, semantic_weight = 0.55` and `k = 40` | These are tunable env vars. Any tune makes the doc wrong. | Say "defaults in the code" and reference the env vars |
| F16 | search.md | 109-118 | Full boost table with exact values | Duplicate of architecture.md table (F12). Two places to update. | Single source of truth in architecture.md; search.md should link there |
| F17 | density-strip.spec.md | 28-29 | `scaleMax = Math.max(maxCount, MIN_SCALE)` where `MIN_SCALE=5` | Direct code mirror. If MIN_SCALE changes, spec lies. | Acceptable in a spec — but add "see `density.js` for current values" |
| F18 | density-strip.spec.md | 67 | `(chartWidth / 21) * 0.8` (~21px) | Direct code mirror of bar width formula | Acceptable in a spec |
| F19 | density-strip.spec.md | 68 | `Math.max(3, (count / scaleMax) * chartHeight)` | Direct code mirror of bar height formula | Acceptable in a spec |
| F20 | density-strip.spec.md | 84-90 | Exact pixel values: 576px, 80px, AXIS_W=2px, 16px, 12px, `0.125rem 0.125rem 0 0.5rem` | Six concrete values that any CSS tweak invalidates | In a spec this is expected, but consider marking with "as of <date>" |

---

## 4. Over-Specified Details (Code Mirrors)

These sections duplicate code so closely that any refactor makes the docs wrong.

| # | File | Section | Excerpt | What to keep | What to remove |
|---|------|---------|---------|-------------|----------------|
| O1 | architecture.md | "Ranking algorithm" (lines 188-207) | Full RRF formula, weights, and boost table | Keep the formula and the table as a reference. | Add "source of truth: `src/lib/hybrid-ranker.ts`" |
| O2 | architecture.md | "BM25 field weights" (lines 172-174) | `title: 16 | subtitle: 8 | headings: 8 | summary: 4 | body: 1 | contributors: 2` | Keep the weight ratios as design rationale. | Add "defined in the FTS5 migration" |
| O3 | search.md | "Lexical search" (lines 22-48) | Exact BM25 call, exact snippet SQL, column indices | Keep the weight table and the reasoning. | Replace exact SQL with a description; link to migration for exact syntax. |
| O4 | search.md | "Deterministic reranking" (lines 105-118) | Boost table duplicated from architecture.md | Keep one copy (architecture.md). | Replace with a link: "See the boost table in `docs/architecture.md`." |
| O5 | density-strip.spec.md | "Sizing" (lines 84-90) | Six exact pixel values, one exact CSS padding value | Keep as the spec's job is to be precise. | Mark with "current as of <date>, verified by `density-geometry.test.ts`" |
| O6 | density-strip.spec.md | "Geometric invariants" (lines 44-62) | 18 numbered invariants with exact descriptions | Keep — this is the spec's core value. | These are fine; they describe tests, not code. |
| O7 | CLAUDE.md | "FTS5 input sanitization" (line 56) | Exact regex: `text.replace(/[^\w\s-]/g, ' ')` | Keep the policy (whitelist approach). | Remove the exact regex; describe the behavior instead. |
| O8 | CLAUDE.md | "State machine" (lines 40-48) | Exact state names and the `densityVisible` flag | Keep state names (they're identifiers). | Fine as-is; states are stable architectural decisions. |
| O9 | architecture.md | "Module map" (lines 130-161) | Full file-by-file module descriptions | Keep as a navigation aid. | **Already stale** — frontend section is missing 5 files. Add a note to verify against `ls`. |

---

## 5. Staleness Risk (Time-Sensitive Content)

| # | File | Section | Text | Staleness speed | Recommendation |
|---|------|---------|------|-----------------|----------------|
| S1 | TODO.md | Entire file | Three TODO items | **Months** — TODOs are expected to be transient. If they linger unfixed for a year, the file becomes a graveyard. | Review quarterly. Delete completed items. Add dates when items were added. |
| S2 | CLAUDE.md | 83-89 | `for offset in 0 50 100 150 200; do` — manual bootstrap command | **Months** — if the batch size or total issues changes, the offsets are wrong | Reference the TODO.md item about automating this. Add a note: "Adjust offsets based on total issue count." |
| S3 | flux.spec.md | 1 | `Product Spec (v2)` — "Updated to reflect what was actually built" | **Months** — any new feature makes v2 incomplete; but nobody updates the spec | Mark as "frozen snapshot" with a date. New features should update architecture.md, not the spec. |
| S4 | flux.spec.md | 156 | `189 tests across 14 files` | **Already stale** — now 618 across 44 | Add "(at time of initial spec freeze)" |
| S5 | lessons-learned.md | 5 | "8 commits over several days" | **Permanent** — this is historical narrative | Fine. Historical narrative doesn't go stale. |
| S6 | search.md | 130-133 | `SEMANTIC_MIN_SCORE = 0.75` and the empirical reasoning | **Months** — if the threshold is tuned, the reasoning becomes misleading | Add "source of truth: `SEMANTIC_MIN_SCORE` in `hybrid-ranker.ts`" |
| S7 | density-strip-research.md | 368 | "No hover interaction on bars" | **Months** — once hover tooltips are added, this becomes wrong | The research doc is a snapshot. Mark as "state at time of research." |
| S8 | density-strip-research.md | 380-381 | "The density strip already has a `density-reveal` CSS animation" | **Months** — CSS may change | Same as S7 |
| S9 | density-strip-research.md | 395 | "Single color (accent color at 0.22 opacity)" | **Months** — opacity may change | Same as S7 |
| S10 | density-strip-research.md | 407-408 | "MILESTONES array... but these don't appear to be rendered" | **Months** — may be rendered by now | Same as S7 |
| S11 | density-strip-research.md | 419 | "CSS includes a media query to hide... on mobile portrait" | **Months** — breakpoint may change | Same as S7 |
| S12 | density-strip.spec.md | 93-94 | Tooltip format: `"Q1 2022 — 8 results (Signposts: 5, Worth your time: 2, Essay: 1)"` | **Months** — any tooltip format change breaks the spec | Acceptable for a spec, but mark as prescriptive, not descriptive |
| S13 | flux.spec.md | 114 | "Processes in batches of 50 per invocation" | **Months** — batch size may change | Say "processes in batches" without the number |
| S14 | flux.spec.md | 60-67 | Section frequency percentages: "~94% (47/50 sampled)" etc. | **Permanent** — these are from a one-time sample and won't be re-run | Add "(sampled once at project start)" — they're already marked "(47/50 sampled)" which is good |

---

## 6. Cross-Document Duplication (Multiple Sources of "Truth")

The same information appears in multiple documents, creating maintenance burden and contradiction risk.

| Fact | Appears in | Recommendation |
|------|-----------|----------------|
| Issue count (234) | README.md, CLAUDE.md, architecture.md, search.md, flux.spec.md, lessons-learned.md, density-strip-research.md | Remove from all except README.md (or remove entirely) |
| Date range (2021-2026) | README.md, CLAUDE.md, architecture.md, search.md, flux.spec.md | Single canonical statement in README.md |
| Test count (618/470/189/120/173) | README.md, CLAUDE.md, architecture.md, search.md, flux.spec.md, lessons-learned.md | Remove all specific counts from non-narrative docs |
| Boost table (+10, +6, +4, etc.) | architecture.md, search.md, flux.spec.md | Single canonical table in architecture.md; others link to it |
| RRF weights (1.0, 0.55, k=40) | architecture.md, search.md, flux.spec.md | Single canonical statement in architecture.md |
| Corpus validation count (1,401) | README.md, CLAUDE.md, lessons-learned.md | Remove the number; say "comprehensive validation" |
| Vector count (~7,773) | architecture.md (twice), search.md | Remove or keep only in architecture.md |
| Response contract (7 fields + 9 fields) | CLAUDE.md, architecture.md, search.md | Single canonical statement in architecture.md; others link |
| Relevance harness size (13 cases) | CLAUDE.md, architecture.md, lessons-learned.md | Remove counts; say "hand-labeled evaluation set" |
| State machine states (5 names) | CLAUDE.md, density-strip.spec.md | Fine — these are stable identifiers, not counts |
| BM25 weights (16/8/8/4/1/2) | architecture.md, search.md | Single canonical table in architecture.md |

---

## 7. Missing Files in Module Map

**architecture.md** (lines 153-157) lists the frontend as:
- `js/app.js`
- `js/lib/autocomplete.js`
- `js/lib/result-list.js`
- `js/lib/utils.js`

**Actually present in `frontend/js/lib/`:**
- `autocomplete.js`
- `density.js` **(missing from docs)**
- `result-list.js`
- `search-state.js` **(missing from docs)**
- `search-state.d.ts` **(missing from docs)**
- `section-labels.js` **(missing from docs)**
- `utils.js`

**Also present in `frontend/js/`:**
- `app.js`
- `issue-page.js` **(missing from docs)**

Five frontend files are undocumented in the module map. This is an active source of confusion for anyone using architecture.md to navigate the codebase.

---

## 8. Summary of Highest-Priority Fixes

| Priority | Issue | Action |
|----------|-------|--------|
| **P0** | Date range "2012-2026" in architecture.md and flux.spec.md is wrong | Fix to "2021-present" |
| **P0** | CLAUDE.md says "230 numbered issues" vs 234 everywhere else | Fix to match or remove count |
| **P0** | CLAUDE.md says "470+" in one place and "618" four lines away | Pick one or remove both counts |
| **P1** | architecture.md module map missing 5 frontend files | Update the map |
| **P1** | Boost table duplicated in 3 docs (architecture.md, search.md, flux.spec.md) | Consolidate to architecture.md; others link |
| **P1** | Issue count (234) appears in 8+ places | Remove from most; keep only in README.md if at all |
| **P2** | Test count (618) appears in 4 places, already contradicted by older snapshots | Remove specific counts from all docs |
| **P2** | flux.spec.md says "189 tests across 14 files" — deeply stale | Mark as frozen snapshot or update |
| **P3** | density-strip-research.md "Current flux-search state" sections will go stale | Add "as of project inception" marker |
| **P3** | Exact pixel values in density-strip.spec.md (576, 80, 2, 16, 12) | Acceptable for a spec; add "verified by tests" note |
