# FLUX Review Search — Product Spec (v2)

> **Note:** This spec is a frozen snapshot from the initial build. For current architecture, see docs/architecture.md.

*Updated to reflect what was actually built. The original spec is preserved as `flux.spec.v1.md`.*

## Summary

A search app for the FLUX Review newsletter archive, running on Cloudflare Workers. Provides hybrid lexical + semantic search across all issues (2021–present) with FTS5 term highlighting, lead essay extraction, and a density strip visualization.

Live at: https://flux-search.adewale-883.workers.dev

## What it does

Users search the complete FLUX Review archive. Each result shows the issue's **lead essay title** (not the Substack template title), an **opening quote**, and a **highlighted snippet** showing where the query matched. Results link directly to Substack for reading.

The search engine combines:
- **D1 FTS5** for lexical matching (exact terms, phrases, date filtering)
- **Vectorize** for semantic matching (concept queries, vocabulary mismatch recovery)
- **Weighted reciprocal rank fusion** to merge both result sets with phrase matches dominating

## Architecture

One Worker. Three bindings: D1, Vectorize, Workers AI. No R2, no Browser Rendering, no KV.

See `docs/architecture.md` for the full module map, data flow, ranking algorithm, and schema.

## Source discovery

All issues come from a single source: the Substack sitemap at `read.fluxcollective.org/sitemap.xml`. It's a flat `<urlset>` (not a sitemap index). Pages are server-rendered HTML fetched with plain `fetch()`.

There is no separate pre-Substack archive. The original spec assumed one existed; it doesn't.

## Issue structure

The FLUX Review publishes weekly since May 2021. The format evolved over time but settled into a consistent template by approximately issue #4.

### Header block (every issue)

```
[site navigation]
# 🌀🗞 The FLUX Review, Ep. N      ← Substack template title (not useful)
### Date                             ← human-readable publish date
[byline, share count, image]
> "Opening quote..."                 ← blockquote, present in every issue
— Attribution
```

The Substack template title is stripped at ingestion. The opening quote and its attribution are extracted as `opening_quote`.

### Lead essay (issues #4+, ~98% of issues)

The first `## ` heading after the header block. This is the unique intellectual content of the issue — a 3-5 paragraph argument about a concept (e.g., "Just enough structure", "The disappearing problem", "Navigating the symmetry of trust").

The lead essay title is used as the display title in search results. Issues #1-3 lack a lead essay (they were Signposts-only); for these, the cleaned Substack title is used as a fallback.

### Recurring sections

These are the columns that recur across issues. Each has an emoji prefix and a consistent name.

| Section | Frequency | Emoji | Content |
|---|---|---|---|
| **Signposts** | ~94% (47/50 sampled) | 🛣️🚩 | Curated links to news/articles with brief commentary |
| **Lens of the week** | ~94% (47/50 sampled) | 🔍 or 🕵️‍♀️📆 | A mental model or framework for thinking |
| **Book for your shelf** | ~90% (45/50 sampled) | 📚🌲 | Book recommendation with review |
| **Postcard from the future** | ~80% (40/50 sampled) | 🔮📬 | Speculative fiction vignette |
| **Worth your time** | ~66% (33/50 sampled) | 📖⏳ | Additional reading/watching/listening |
| **More from FLUXers** | ~30% (15/50 sampled) | 🌀🖋 | Writing by FLUX Collective members |

Special issues break the pattern: #3 is a book review, #80 is a year-in-review, #100 is a retrospective.

### What this means for search

A search result card shows: **lead essay title** (what the issue is about), **opening quote** (the issue's voice), and **highlighted snippet** (where the query matched). No separate "summary" field — the snippet does both jobs. The lead essay title is indexed at title weight (16.0) in FTS5, making it the strongest signal for relevance.

## Search operators

| Operator | Example | Behavior |
|---|---|---|
| `before:` | `before:2024-01-01` | Strictly earlier than date |
| `after:` | `after:2023-06-01` | Strictly later than date |
| `year:` | `year:2024` | Exact year match |
| `issue:` | `issue:198` | Direct issue number lookup |
| `"..."` | `"just enough structure"` | Exact phrase match |

Date validation rejects impossible dates (Feb 30, Sep 31) via roundtrip verification.

## Ranking

Phrase matches beat semantic-only matches. This is the core product behavior.

**Fusion**: Weighted reciprocal rank fusion (lexical weight 1.0, semantic weight 0.55, k=40). Configurable via env vars without redeploying.

**Boosts**: Exact issue +10, phrase in title +6, phrase in heading +4, phrase in body +3, title overlap +1.5, lexical+semantic agreement +1.25, multiple chunks +0.75.

**Penalty**: Semantic-only result when strong lexical competition exists: -3.5.

**Confidence tiers**: Results are classified as high (phrase/exact match), medium (lexical match), or low (penalized semantic-only). High-confidence results render with heavier typography; low-confidence results fade.

## Frontend

Single-page search app. No issue detail page — results link directly to Substack.

Features:
- Autocomplete for operators and corpus terms
- FTS5 `snippet()` highlighting with `<mark>` tags
- Density strip: SVG area silhouette showing result distribution across years, with landmark annotations (#1, #50, #100, #200) and year tick marks
- Progressive disclosure: top 3 results get 400-char snippets, rest get 150-char
- Browser back/forward support via `popstate`

## Ingestion

### Bootstrap
Triggered via `POST /admin/bootstrap`. Discovers all issue URLs from the sitemap, fetches each page, normalizes into structured records, chunks for semantic indexing, embeds via Workers AI, and upserts into D1 + Vectorize.

Processes in batches per invocation (Worker CPU time limit). Idempotent — re-running skips already-ingested issues via source URL dedup. Typically completes in 3-4 invocations for the full 234-issue archive.

### Weekly sync
Cron trigger: Saturdays at 06:00 UTC. Diffs the sitemap against D1, ingests only missing episodes. Bounded to 20 per run.

### Embedding
Best-effort: if Workers AI or Vectorize are unavailable (e.g., local dev), ingestion continues with D1/FTS only. Embeddings can be added later via `/admin/reindex`.

Old Vectorize vectors are cleaned up when an issue is re-chunked (orphan deletion).

## Admin endpoints

All require `Authorization: Bearer <ADMIN_TOKEN>`.

- `POST /admin/bootstrap` — Start or continue archive ingestion
- `POST /admin/reindex` — Re-chunk and re-embed all issues
- `GET /admin/crawl-runs/:id` — Crawl run status
- `GET /admin/coverage` — Archive completeness: total issues, date range, missing issue numbers

## Security

- Admin auth: SHA-256 hash comparison (constant-time, no length leakage)
- All D1 queries use prepared statements with `.bind()`
- Query input truncated to 500 characters
- CORS enabled
- Observability: full log sampling enabled

## What's not built

Deliberately excluded (present in v1 spec but removed during implementation):
- R2 for raw crawl artifacts (idempotent re-crawl makes this unnecessary)
- Browser Rendering (Substack is server-rendered)
- `source_platform` / `source:` operator (single source)
- `issue_aliases` table (no alternate URLs)
- Rate limiting middleware (doesn't work across Workers isolates; use Cloudflare WAF)
- Issue detail pages (replaced with direct Substack links)
- `cover_image_url`, `slug`, `search_text` fields (dead weight)
- LLM/cross-encoder reranking (deterministic ranker is sufficient)
- Query logging (deferred to v2)

## Testing

189 tests across 14 files (at time of initial spec freeze, v2). Property-based testing with fast-check found 8 bugs during development:
- Invalid date acceptance (Sep 31, month 00, month 99)
- Issue number extraction failure for `/p/N-slug` URLs
- Opening quote stripping edge cases
- Markdown link stripping with empty text and nested brackets
- Timezone-shifted human-readable date parsing
- `<body>` tag matched by `<b>` regex in HTML converter
