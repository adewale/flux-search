# Architecture

## System overview

Flux Search is a Cloudflare Workers application that provides hybrid lexical + semantic search across the FLUX Review newsletter archive. It serves 234 issues from 2012-2026.

```
                    ┌─────────────────────────────────┐
                    │        Cloudflare Worker         │
                    │                                  │
   Browser ──────► │  Hono routes ──► Search engine   │
                    │       │              │     │     │
                    │       │         FTS5 │     │ AI  │
                    │       ▼              ▼     ▼     │
                    │   Static Assets    D1   Vectorize │
                    └─────────────────────────────────┘
```

Three Cloudflare bindings:
- **D1** — SQLite database with FTS5 for lexical search and issue storage
- **Vectorize** — 768-dimensional vector index for semantic search (7,773 vectors)
- **Workers AI** — `@cf/baai/bge-base-en-v1.5` for embedding generation

No R2, no Browser Rendering, no KV. The architecture was simplified from the original spec after discovering these services weren't needed.

## Data flow

### Ingestion (bootstrap + weekly sync)

```
Substack sitemap ──► sitemap-parser ──► URLs
                                         │
                          for each URL:  │
                                         ▼
                       fetch HTML ──► crawl-client ──► markdown + metadata
                                                           │
                                                           ▼
                                                      normalizer
                                                     ┌────┴────┐
                                                     │         │
                                               issue record  structure
                                              (clean title,  (lead essay,
                                               headings,     opening quote,
                                               plain text)   summary)
                                                     │
                                              ┌──────┼──────┐
                                              ▼      ▼      ▼
                                             D1    chunks  Vectorize
                                           (FTS5) (D1)   (embeddings)
```

### Search (per request)

```
User query ──► query-parser ──► ParsedQuery
                                    │
                         ┌──────────┼──────────┐
                         ▼                     ▼
                    D1 FTS5               Vectorize
                  (lexical)             (semantic)
                    BM25 ranked          chunk-level
                    + highlight          cosine similarity
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                            hybrid-ranker
                         (weighted RRF fusion
                          + deterministic
                            reranking)
                                    │
                                    ▼
                              ranked results
                           with confidence tiers,
                           highlighted snippets,
                           year distribution
```

## Search pipeline (operation ordering)

The search handler in `src/routes/search.ts` has three paths that must all
produce the same response shape. The ordering of operations has dependencies
that caused bugs when violated — this diagram documents the correct sequence.

```
Query string
    │
    ├─ issue:N only ──► getIssueByNumber ──► detect section ──► aggregates ──► respond
    │
    ├─ filter only ──► searchFilterOnly ──► detect sections ──► aggregates ──► paginate ──► respond
    │
    └─ text search ──► parse ──► FTS + Vectorize (parallel)
                                        │
                                        ▼
                                   rankResults (RRF fusion)
                                        │
                                        ▼
                               detectSnippetSection  ◄── MUST run here:
                               (on ALL ranked results)   before filter, before aggregates
                                        │
                                        ▼
                               section filter (if section: operator)
                                        │
                                        ▼
                               compute aggregates:
                                 • year_distribution
                                 • quarter_distribution (with sections)
                                 • section_facets
                                        │
                                        ▼
                                   paginate
                                        │
                                        ▼
                                   respond
```

**Critical ordering constraint:** `detectSnippetSection` must run on all ranked
results BEFORE the section filter and aggregate computations. FTS-only results
have null `snippetSection` from the ranker — detection fills it in by parsing
the issue markdown. If detection runs after pagination (as it did originally),
aggregates undercount sections and the section filter fails on FTS results.

**Response contract:** All three paths return the same 7 top-level fields
(`parsed_query`, `applied_filters`, `total_hits`, `year_distribution`,
`quarter_distribution`, `section_facets`, `results`) and each result has 9
fields (`issue_id`, `title`, `issue_number`, `published_at`, `snippet`,
`snippet_section`, `confidence`, `canonical_url`, `matched_by`).

## Module map

### Routes (`src/routes/`)
- `search.ts` — `GET /search`, `GET /autocomplete`. Orchestrates query parsing, parallel FTS + Vectorize search, hybrid ranking, pagination.
- `issues.ts` — `GET /issues/:id`, `GET /issues/issue/:number`. Issue detail API.
- `admin.ts` — `POST /admin/bootstrap`, `POST /admin/reindex`, `GET /admin/crawl-runs/:id`, `GET /admin/coverage`. Protected by bearer token auth.

### Search engine (`src/lib/`)
- `query-parser.ts` — Parses raw query string into free text, quoted phrases, and filter operators (`before:`, `after:`, `year:`, `issue:`, `section:`).
- `hybrid-ranker.ts` — Weighted reciprocal rank fusion of FTS and Vectorize results. Applies deterministic boosts (exact issue +10, phrase in title +6, phrase in heading +4, phrase in body +3) and penalties (semantic-only -3.5). Classifies results into high/medium/low confidence tiers. Progressive snippet disclosure (top 3 get 400 chars, rest get 150).
- `vector-search.ts` — Embeds query via Workers AI, queries Vectorize, collapses chunk-level results to issue-level candidates.
- `chunker.ts` — Splits issue text into 300-800 token chunks for semantic indexing. Respects section boundaries. First chunk is always title + summary.
- `embedder.ts` — Batches text chunks through Workers AI for 768-dim embeddings, upserts to Vectorize.
- `normalizer.ts` — Transforms crawled HTML into structured issue records. Extracts the intrinsic structure of FLUX Review issues: opening quote, lead essay title, lead essay body, headings. Cleans Substack boilerplate from titles.
- `deduplicator.ts` — Checks for duplicate issues by source URL, content hash, or issue number + date.

### Crawler (`src/crawler/`)
- `sitemap-parser.ts` — Fetches the Substack sitemap, extracts issue URLs. Handles both flat `<urlset>` and sitemap index formats.
- `crawl-client.ts` — Fetches pages via plain HTTP (Substack is server-rendered). Converts HTML to markdown. Extracts metadata from `<meta>` tags. Decodes HTML entities including smart quotes and numeric references.
- `bootstrap.ts` — Orchestrates discovery + ingestion in batched iterations. `computeBatchPlan` determines which URLs to process next.
- `ingestor.ts` — Pipeline for a single page: normalize → deduplicate → upsert D1 → chunk → embed → upsert Vectorize. Embedding is best-effort (gracefully degrades when AI unavailable).

### Cron (`src/cron/`)
- `weekly-sync.ts` — Runs every Saturday at 06:00 UTC. Diffs the sitemap against D1 and ingests only missing episodes. Bounded to 20 per run.

### Frontend (`frontend/`)
- `js/app.js` — Router: wires autocomplete, search, and result rendering.
- `js/lib/autocomplete.js` — Reusable autocomplete pattern. Debounced, keyboard-navigable.
- `js/lib/result-list.js` — Renders results with density strip (SVG area silhouette with year ticks and landmark annotations), confidence tiers, FTS term highlighting, and direct Substack links.
- `js/lib/utils.js` — Shared: escapeHtml, formatDate, cleanSnippet, markdownToHtml.

### Middleware (`src/middleware/`)
- `admin-auth.ts` — Bearer token auth with SHA-256 hash comparison (constant-time, no length leakage).

## Database schema

### D1 tables
- `issues` — Primary record. 23 columns including `title`, `headings`, `lead_essay_title`, `opening_quote`, `full_text_markdown`, `full_text_plain`.
- `issue_chunks` — Chunked text for semantic indexing. Linked to issues by `issue_id`.
- `crawl_runs` — Audit log for bootstrap and sync operations.
- `issues_fts` — FTS5 virtual table over title, subtitle, headings, summary, full_text_plain, contributors. Synced via triggers.
- `issues_fts_vocab` — FTS5 vocabulary for autocomplete.

### BM25 field weights
```
title: 16 | subtitle: 8 | headings: 8 | summary: 4 | body: 1 | contributors: 2
```

### Vectorize index
- Name: `flux-search-chunks`
- Dimensions: 768 (bge-base-en-v1.5)
- Metric: cosine
- Vector count: ~7,773 (234 issues × ~33 chunks average)
- Metadata: issue_id, issue_number, published_at, title, section_label, chunk_text

## Ranking algorithm

> For the reasoning behind these choices and a guide to tuning them, see [search.md](search.md).

Weighted reciprocal rank fusion with deterministic reranking:

```
fusion_score = lexical_weight × (1 / (k + lexical_rank))
             + semantic_weight × (1 / (k + semantic_rank))
```

Defaults: `lexical_weight=1.0`, `semantic_weight=0.55`, `k=40`.

Post-fusion boosts:
| Boost | Value | Condition |
|---|---|---|
| Exact issue number | +10.0 | `issue:N` matches `issue_number` |
| Phrase in title | +6.0 | Quoted phrase found in title |
| Phrase in heading | +4.0 | Quoted phrase found in subtitle or headings |
| Phrase in body | +3.0 | Quoted phrase found in full_text_plain |
| Title term overlap | +1.5 | ≥2 query terms appear in title |
| Lexical+semantic agreement | +1.25 | Same issue appears in both result sets |
| Multiple chunks | +0.75 | ≥2 semantic chunks from same issue |
| Semantic-only penalty | -3.5 | Result only from Vectorize when ≥3 FTS results exist |

## Configuration

All tuning parameters are Cloudflare Worker env vars, changeable without redeploying code:
- `LEXICAL_WEIGHT` — FTS contribution to fusion (default: 1.0)
- `SEMANTIC_WEIGHT` — Vectorize contribution to fusion (default: 0.55)
- `RRF_K` — Reciprocal rank fusion smoothing constant (default: 40)
- `ADMIN_TOKEN` — Secret for admin endpoints

## Testing

618 tests across 44 files:
- Unit tests for all pure-logic modules (query parser, chunker, normalizer, ranker, auth, crawl client, sitemap parser)
- Property-based tests with fast-check for regex-heavy functions, mathematical invariants, and string transformations
- Corpus validation tests: crud removal and content survival across all 234 raw HTML files
- Search consistency PBT: aggregate totals must equal total_hits across all query paths
- Integration tests against the live API: response shape, aggregate consistency, pagination stability
- Relevance evaluation harness: 13 hand-labeled {query → expected result} cases
- Visual regression tests: 12 Playwright screenshot comparisons (6 pages × 2 viewports)
- Shared test helpers in `test/helpers.ts`

PBT found 8+ real bugs during development, all fixed.
