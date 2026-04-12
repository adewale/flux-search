# FLUX Review Search

Search every issue of [The FLUX Review](https://read.fluxcollective.org) newsletter. Hybrid lexical + semantic search across 234 issues from 2021-2026, deployed as a single Cloudflare Worker.

**Live:** [flux-search.adewale-883.workers.dev](https://flux-search.adewale-883.workers.dev/)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/flux-search)

## Features

- **Hybrid search** -- D1 FTS5 (BM25) and Vectorize (cosine similarity) fused via weighted reciprocal rank fusion
- **Search operators** -- `before:2024`, `year:2023`, `issue:198`, `section:lens`, `"exact phrase"`
- **Section-aware results** -- each issue is parsed into its intrinsic structure (lead essay, signposts, lens, book, postcard) with section filtering and faceted results
- **Confidence tiers** -- results ranked high/medium/low with visual weight reflecting match quality
- **Auto-sync** -- weekly cron discovers and ingests new issues from the Substack sitemap

## Search language

| Operator | Example | Effect |
|----------|---------|--------|
| `"..."` | `"institutional trust"` | Exact phrase match |
| `before:` | `before:2024-01-01` | Issues published before date |
| `after:` | `after:2023-06-01` | Issues published after date |
| `year:` | `year:2023` | Issues from a specific year |
| `issue:` | `issue:198` | Jump to a specific issue |
| `section:` | `section:lead_essay` | Filter by section type |

Section types: `lead_essay`, `signposts`, `lens`, `book`, `postcard`, `worth_your_time`, `fluxers`.

## Quick start

> Requires Node.js 18+, a Cloudflare account, and `npm install -g wrangler`

```bash
git clone https://github.com/adewale/flux-search.git
cd flux-search
npm install
```

Create a D1 database and Vectorize index, then update `wrangler.jsonc` with your IDs:

```bash
wrangler d1 create flux-search-db
wrangler vectorize create flux-search-chunks --dimensions 768 --metric cosine
```

Run migrations and start the dev server:

```bash
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787`. The search is empty until you bootstrap content.

### Bootstrapping content

Set an `ADMIN_TOKEN` in `.dev.vars`, then bootstrap from the Substack sitemap:

```bash
curl -X POST http://localhost:8787/admin/bootstrap \
  -H "Authorization: Bearer YOUR_TOKEN"
```

This fetches all issues, normalizes content, chunks text, generates embeddings, and indexes everything. Run it multiple times if needed -- it's idempotent.

### Local corpus pipeline

For faster iteration on content normalization without re-fetching from Substack:

```bash
npm run corpus:fetch      # download raw HTML once
npm run corpus:process    # normalize locally (no network)
npm run corpus:validate   # 1,401 checks across 234 records
```

## Development

```bash
npm run dev           # local dev server (port 8787)
npm test              # run 472 tests
npm run test:watch    # watch mode
```

Tests include property-based testing with fast-check for regex-heavy parsers and mathematical invariants.

### Deploy

```bash
npm run db:migrate:remote   # apply migrations to production D1
npm run deploy              # deploy to Cloudflare Workers
```

## Architecture

```
Browser --> Cloudflare Worker (Hono)
               |
          +---------+----------+-----------+
          |         |          |           |
       Static    D1 (FTS5)  Vectorize   Workers AI
       Assets    (lexical)  (semantic)  (embeddings)
```

A search query is parsed into free text, quoted phrases, and filter operators. FTS5 and Vectorize run in parallel, and results are fused via reciprocal rank fusion with deterministic reranking boosts for phrase matches, title overlap, and cross-signal agreement.

See [docs/architecture.md](docs/architecture.md) for the full module map, database schema, and configuration reference, and [docs/search.md](docs/search.md) for a detailed explanation of the hybrid search design and how to tune it for a different corpus.

## Built with

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) -- compute
- [D1](https://developers.cloudflare.com/d1/) -- SQLite database with FTS5
- [Vectorize](https://developers.cloudflare.com/vectorize/) -- vector search index
- [Workers AI](https://developers.cloudflare.com/workers-ai/) -- `bge-base-en-v1.5` embeddings
- [Hono](https://hono.dev/) -- web framework
- [Vitest](https://vitest.dev/) + [fast-check](https://fast-check.dev/) -- testing
