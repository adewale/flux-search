# CLAUDE.md

## What is this?

A search engine for [The FLUX Review](https://read.fluxcollective.org) newsletter archive. Hybrid lexical + semantic search across all issues of The FLUX Review, published weekly since 2021, deployed as a single Cloudflare Worker.

Live: https://flux-search.adewale-883.workers.dev/

## Stack

- **Runtime:** Cloudflare Workers (Hono framework)
- **Database:** D1 (SQLite + FTS5 for lexical search)
- **Vectors:** Vectorize (768-dim, bge-base-en-v1.5 via Workers AI)
- **Frontend:** Vanilla JS, no build step, served as static assets
- **Tests:** Vitest (unit + PBT), Playwright (e2e + visual regression)

## Critical constraints

### Search pipeline ordering (src/routes/search.ts)

The search handler has ordering dependencies that caused bugs when violated:

```
rank → detect sections → filter by section → compute aggregates → paginate
```

- `detectSnippetSection` MUST run on ALL ranked results BEFORE the section filter and aggregate computations. FTS-only results have null `snippetSection` from the ranker.
- All three query paths (normal, filter-only, issue-lookup) MUST return the same response shape (see Response contract in docs/architecture.md).

### Normalizer regex ordering (src/lib/normalizer.ts)

The many cleaning regexes have ordering dependencies:

- Profile link stripping MUST run before byline cleanup (orphaned commas only appear after links are removed)
- Subscribe stripping runs in a single final pass (after all other rules expose standalone Subscribe lines)
- The image caption regex runs twice: early (catches standalone captions) and late (catches captions exposed by earlier stripping)

### State machine (frontend/js/lib/search-state.js)

The search box is driven by a pure state machine with 5 states:

- `LANDING_FEATURED` → cold-start, waiting for /latest-issue
- `FEATURED_RESULTS` → latest issue loaded, quote visible, density hidden
- `LANDING` → stable empty state
- `RESULTS` → user-driven search, density visible
- `BROWSING` → user dismissed search, results still visible

The `densityVisible` flag controls whether the density strip appears. It's false for all landing states and true for RESULTS.

### Type boundary: ChunkLabel vs DisplaySection (src/lib/sections.ts)

Chunk labels (internal, for vector index) and display sections (user-facing) are distinct types. `toDisplaySection()` is the single conversion point. `title_summary` maps to `lead_essay`. Any unmapped label becomes `other`. This prevents internal labels from leaking to the UI.

### FTS5 input sanitization (src/routes/search.ts)

User input is sanitized to word characters, spaces, and hyphens before FTS5 MATCH. Apostrophes, colons, angle brackets, ampersands, and slashes all cause FTS5 syntax errors. The whitelist approach (keep only safe characters) is safer than blacklisting known dangerous characters.

### Visual alignment (e2e/density-alignment.spec.ts)

The page has two alignment edges: 0px for chrome and ~8px for content. Playwright tests verify rendered bounding boxes align — `getBoundingClientRect()` is the source of truth, not SVG coordinate math. CSS `aspect-ratio` overrides can silently distort SVG coordinate mapping.

## Testing approach

- **Red-green TDD** for all features and bug fixes
- **Property-based testing** (fast-check) for parsers, mathematical invariants, and pipeline consistency
- **Corpus tests** run against all 234 raw HTML files in `data/raw/` — validates crud removal and content survival
- **Integration tests** call the live API and assert response invariants (shape, aggregate consistency, pagination stability)
- **Relevance harness** — 13 hand-labeled {query → expected result} cases
- **Visual regression** — Playwright screenshots compared against baselines

Run `npx vitest run` for unit/PBT/corpus tests. Run `npx playwright test` for e2e/visual/alignment.

## Common operations

```bash
npm run dev              # local dev server (port 8787)
npm test                 # Run `npx vitest run` for unit/PBT/corpus tests
npm run typecheck         # generate Worker types and run TypeScript checks
npm run corpus:fetch     # download raw HTML from Substack
npm run corpus:process   # normalize locally
npm run corpus:validate  # validates all corpus records

# Force re-bootstrap (re-normalize + re-chunk + re-embed all issues):
for offset in 0 50 100 150 200; do
  curl -X POST "https://flux-search.adewale-883.workers.dev/admin/bootstrap?force=true&offset=$offset" \
    -H "Authorization: Bearer $ADMIN_TOKEN" &
done

# Re-embed only (no re-fetch):
curl -X POST .../admin/reindex -H "Authorization: Bearer $ADMIN_TOKEN"

# Update visual regression baselines after UI changes:
npx playwright test e2e/visual-regression.spec.ts --update-snapshots

# e2e tests hit the deployed Worker by default; to test local changes:
PLAYWRIGHT_BASE_URL=http://localhost:8787 npx playwright test
```

## Design principles

- **Tufte:** Data-ink ratio, no decoration that doesn't encode data
- **Robin Williams CRAP:** Contrast (confidence tiers), Repetition (type scale), Alignment (left-aligned), Proximity (metadata grouped)
- **Typography:** 5 sizes (1.5× ratio), 4 weights, 3 fonts (Lora/Literata/DM Sans), zero raw CSS values
- **Section colors:** oklch(65% 0.08 H) — same lightness/chroma, vary only hue. Defined as CSS custom properties (`--section-lead-essay` etc.)

### Tokens that must be used (no raw values)

- **Sizes:** `--size-sm` / `--size-base` / `--size-lg` / `--size-xl` / `--size-hero`. Do not introduce a `--size-xs`; the 13px floor was raised for accessibility.
- **Radii:** `--radius-sm` (3px corners), `--radius` (6px corners), `--radius-pill` (999px chip primitive).
- **Tracking:** `--tracking-tight` (large text) / `--tracking-open` (small text). Two values total — uppercase microcopy uses `--tracking-open`, not a third token.
- **Backgrounds:** `--surface` (white panels) and `--tag-bg` (chip / hover-row tint). Do not write raw `rgba(0,0,0,…)` for hover or chip surfaces.

### Shared UI primitives

- **`.chip`** — pill-shaped link primitive. Used on result cards, the issue-page topic side panel, the landing themes strip, and adjacent topics on `/topics/:keyword`. One class, no per-surface variants. Modifiers (e.g. `.chip-burst`) decorate; the base shape is invariant.
- **`.eyebrow`** — small uppercased section label (e.g. "Topics", "Recurring themes", "Context shifts"). `--size-sm`, weight 600, `--tracking-open`, `text-transform: uppercase`. Use this instead of redeclaring the same rules per surface.
- **Confidence tiers** — one mechanism only: high gets `font-weight: 700`, low gets `font-weight: 400` plus `opacity: 0.6`. Used on `.result-card` and `.topics-row`. Never render confidence as opacity-only — that loses the typographic hierarchy.

### Breakpoints

CSS custom properties cannot be referenced from `@media` queries, so the breakpoint scale is documented in `:root` as a comment and the values are repeated in each query. Three breakpoints, no more:

- `(max-width: 640px) and (orientation: portrait)` — handheld portrait.
- `(min-width: 900px)` — tablet+. The issue page swaps from inline `<details>` to a sticky side panel here. Its exclusive complement `(max-width: 899px)` counts as the same breakpoint.
- `(max-width: 920px) and (orientation: landscape)` — handheld landscape.

Capability queries (`prefers-reduced-motion`, `hover/pointer`) are orthogonal to the layout scale and allowed. The full allowlist — and the token rules above — are pinned by `test/css-tokens.test.ts`.

## Where to find things

- Search design rationale: `docs/search.md`
- System architecture + pipeline diagram: `docs/architecture.md`
- Project retrospective: `docs/lessons-learned.md`
- Density strip research: `docs/density-strip-research.md`
- Remaining work: `TODO.md`
