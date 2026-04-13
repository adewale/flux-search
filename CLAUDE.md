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
```

## Design principles

- **Tufte:** Data-ink ratio, no decoration that doesn't encode data
- **Robin Williams CRAP:** Contrast (confidence tiers), Repetition (type scale), Alignment (left-aligned), Proximity (metadata grouped)
- **Typography:** 5 sizes (1.5× ratio), 4 weights, 3 fonts (Lora/Literata/DM Sans), zero raw CSS values
- **Section colors:** oklch(65% 0.08 H) — same lightness/chroma, vary only hue. Defined as CSS custom properties (`--section-lead-essay` etc.)

## Where to find things

- Search design rationale: `docs/search.md`
- System architecture + pipeline diagram: `docs/architecture.md`
- Project retrospective: `docs/lessons-learned.md`
- Density strip research: `docs/density-strip-research.md`
- Remaining work: `TODO.md`
