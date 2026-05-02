# Yaket Topic Extraction Specification

> Status note, 2026-05-01: this document describes the original Yaket topic extraction plan. Current production behavior is documented in `docs/topic-pipeline.md`. Production topic rebuilds now use the correct-by-construction boundary and queue-backed rebuild architecture documented in `specs/topic-pipeline-correct-by-construction.spec.md`, `specs/flux-queues.spec.md`, and `docs/topic-system-status.md`.

Extract key topics (words and phrases) from each issue of The FLUX Review and from the overall corpus, then surface them across the site as chips, filters, facets, and a dedicated topics page.

## Motivation

Search today is lexical + semantic over chunks. Readers have no way to ask "what does FLUX talk about?" at a glance — there is no topical spine. Topics give us:

- Per-issue chips that make each issue scannable.
- A corpus-wide theme list that answers "what has FLUX been about for 5 years?"
- A new `topic:` query operator that complements free-text search.
- Autocomplete suggestions rooted in real editorial content, not canned examples.
- Related-issue links via topic overlap.

## Library

[`@ade_oshineye/yaket@0.5.3`](https://www.npmjs.com/package/@ade_oshineye/yaket) — a TypeScript port of YAKE, fully bundled stopwords, and no network dependency. Runs inside Cloudflare Workers.

- Deterministic (same input → same output). Re-extraction is a no-op when `content_hash` is unchanged.
- No LLM; no per-call cost.
- Single-document by design — corpus view is built by aggregation, not by running YAKE on concatenated text.

### API

```ts
import { extract } from '@ade_oshineye/yaket/worker';

const keywords = extract(text, {
  language: 'en',
  n: 3,          // max n-gram size
  top: 25,       // results returned
  dedupLim: 0.85,
  dedupFunc: 'seqm',
  windowSize: 1,
});
// [[ "institutional trust", 0.0187 ], ...]
```

**Important:** YAKE scores are inverse — **lower score = more relevant**.

## Extraction scopes

Two levels, both derived from the same `extract()` function:

| Scope | Input | Storage | When computed |
|---|---|---|---|
| **Issue** | `issues.full_text_plain` | `issue_topics` | During `ingestPage` |
| **Corpus** | aggregation over `issue_topics` | `corpus_topics`, `topic_timeline` | Cron + admin route |

Section-level extraction is intentionally out of scope: it complicates the data model, doubles extraction cost per ingest, and the UI does not currently use section-grouped topics. The existing `section:` facet is unaffected.

## Data model

Migration `migrations/0006_topics.sql`:

```sql
CREATE TABLE issue_topics (
  issue_id       TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,           -- normalized: lowercased, punctuation stripped
  keyword_display TEXT NOT NULL,          -- original casing, for UI
  score          REAL NOT NULL,           -- YAKE score (lower = better)
  rank           INTEGER NOT NULL,        -- 1..top_n
  ngram_size     INTEGER NOT NULL,
  PRIMARY KEY (issue_id, keyword)
);
CREATE INDEX idx_issue_topics_keyword ON issue_topics(keyword);
CREATE INDEX idx_issue_topics_rank    ON issue_topics(issue_id, rank);

CREATE TABLE corpus_topics (
  keyword         TEXT PRIMARY KEY,
  keyword_display TEXT NOT NULL,
  doc_frequency   INTEGER NOT NULL,       -- # distinct issues containing keyword
  avg_score       REAL NOT NULL,          -- mean YAKE score across those issues
  aggregate_score REAL NOT NULL,          -- doc_frequency / avg_score
  first_seen      TEXT,                   -- earliest issue published_at
  last_seen       TEXT,                   -- latest
  ngram_size      INTEGER,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_corpus_topics_agg ON corpus_topics(aggregate_score DESC);

CREATE TABLE topic_timeline (
  keyword     TEXT NOT NULL,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (keyword, year, month)
);

CREATE TABLE topic_blocklist (
  keyword  TEXT PRIMARY KEY,
  reason   TEXT,
  added_at TEXT NOT NULL
);
```

### Aggregation score

`aggregate_score = doc_frequency / avg_score`

A topic that is a strong YAKE hit (low score) across many issues wins. This avoids the failure mode of running YAKE on concatenated text, where common newsletter words score spuriously high.

### Noise controls

1. Run extraction on `full_text_plain` **after** the normalizer has stripped subscribe blocks, image captions, profile links, and bylines (see `src/lib/normalizer.ts`).
2. Drop topics where `doc_frequency / total_issues > 0.70` — boilerplate suppressor.
3. `topic_blocklist` table for maintainer overrides (e.g. recurring masthead phrases).
4. `HAVING doc_frequency >= 2` on corpus aggregation — drop hapax legomena.

## Pipeline

### Per-issue extraction (inline in ingestor)

`src/lib/topic-extractor.ts`:

```ts
import { extract } from '@ade_oshineye/yaket/worker';

export interface ExtractedTopic {
  keyword: string;
  keyword_display: string;
  score: number;
  rank: number;
  ngram_size: number;
}

export function extractTopics(
  text: string,
  opts: { top?: number; n?: number } = {}
): ExtractedTopic[] {
  const results = extract(text, {
    language: 'en',
    n: opts.n ?? 3,
    top: opts.top ?? 25,
    dedupLim: 0.85,
  });
  return results.map(([kw, score], i) => ({
    keyword: normalizeKeyword(kw),
    keyword_display: kw,
    score,
    rank: i + 1,
    ngram_size: kw.trim().split(/\s+/).length,
  }));
}
```

Wire into `rechunkAndEmbed` (`src/crawler/ingestor.ts`), next to the embedder call, treated as best-effort like embedding:

```ts
try {
  const topics = extractTopics(issue.full_text_plain);
  await replaceIssueTopics(env.DB, issue.id, topics);
} catch (err) {
  console.error(`Topic extraction skipped for issue ${issue.id}:`, err);
}
```

Gating on `content_hash` (already in place for embeddings) makes this cheap on re-runs.

### Corpus aggregation

`buildCorpusTopics()` — pure SQL executed against D1:

```sql
DELETE FROM corpus_topics;
INSERT INTO corpus_topics
SELECT
  t.keyword,
  MAX(t.keyword_display),
  COUNT(DISTINCT t.issue_id)                         AS doc_frequency,
  AVG(t.score)                                       AS avg_score,
  COUNT(DISTINCT t.issue_id) * 1.0 / AVG(t.score)    AS aggregate_score,
  MIN(i.published_at),
  MAX(i.published_at),
  MAX(t.ngram_size),
  datetime('now')
FROM issue_topics t
JOIN issues i ON i.id = t.issue_id
WHERE t.keyword NOT IN (SELECT keyword FROM topic_blocklist)
GROUP BY t.keyword
HAVING doc_frequency >= 2;
```

Timeline aggregation:

```sql
DELETE FROM topic_timeline;
INSERT INTO topic_timeline
SELECT t.keyword, i.year, i.month, COUNT(*) AS occurrences
FROM issue_topics t
JOIN issues i ON i.id = t.issue_id
GROUP BY t.keyword, i.year, i.month;
```

Historical estimate: 234 issues × ~25 topics = ~6k rows. Current production no longer assumes a single Worker transaction is safe; full rebuild work is queue-backed.

### Triggers

| Trigger | Action |
|---|---|
| `ingestPage` | Per-issue extraction for the newly-ingested issue |
| `runReindex` | Walks all issues → rebuilds `issue_topics` |
| `POST /admin/rebuild-topics` | Queue-backed full rebuild planner; enqueues extraction/finalization/embedding jobs |
| Weekly cron (`src/cron/weekly-sync.ts`) | Calls rebuild/enrichment paths after ingest |

### Backfill

`POST /admin/rebuild-topics` creates a pipeline run, builds the phrase lexicon, enqueues bounded `topic-extract-batch` jobs, and enqueues `topic-finalize-rebuild`. The old monolithic `?backfill=true` description is historical; it exceeded Worker CPU limits as the pipeline became more sophisticated.

## Surfacing on the website

### Landing page (`frontend/index.html`)
- Reading order: quote → search box → example queries → **Latest issue** card → **Recurring themes** strip.
- The latest-issue card adds a `Topics: a · b · c` subtitle (top 3 from `issue_topics`).
- "Recurring themes" strip: top 12 `corpus_topics` by `aggregate_score`. Tufte-friendly — font size proportional to `log(doc_frequency)`, single hue, no word-cloud bubbles. Each theme links to `/?q=topic:"…"`.

### Search result cards (`frontend/js/app.js`)
- One subtitle line per card: `Topics: trust · legitimacy · civic repair` (top 3 from `issue_topics`).
- Rendered on its own row below the snippet — not inline with section metadata — so it wraps cleanly on mobile.

### Issue page (`frontend/issue.html`)
- **Topics side panel** (desktop ≥900px): `<aside>` column, ~220px wide, right of the article. `position: sticky; top: 1rem` so it stays visible while scrolling. Layout: `grid-template-columns: minmax(0, 1fr) 220px; gap: 2rem`.
  - Panel header "Topics" with up to 8 topic chips from `issue_topics` ordered by `rank`. Each chip links to `/?q=topic:"…"`.
  - Below topics, same panel: "Related issues" — Jaccard over top-10 keyword sets, top 3 shown.
- **Mobile (<900px)**: grid collapses to a single column; the aside becomes two inline `<details>` blocks — "Topics (N)" above the article (collapsed by default, so the first paragraph stays above the fold) and "Related issues" below the article body.

### `topic:` query operator (`src/lib/query-parser.ts`)
- `topic:"institutional trust"` → `WHERE EXISTS (SELECT 1 FROM issue_topics WHERE issue_id = issues.id AND keyword = ?)`.
- Cheaper than FTS5 MATCH, so it can combine with free-text queries.
- Exempt from the FTS5 sanitizer — parameterized binds only. Must be extracted from the query string **before** FTS5 sanitization in `src/routes/search.ts`.

### `/topics` page (new)
- Sortable full list: frequency / recency / alphabetical.
- Per-topic sparkline from `topic_timeline` showing month/year distribution — matches density-strip aesthetic.
- Click-through → filtered search.

### Autocomplete
- **Unchanged**. The existing `autocomplete-dropdown` keeps its current behavior (history + operator hints). Topic discovery lives in the themes strip, `/topics`, issue-page chips, and result-card subtitles — not inside the search input. Adding a third category to the dropdown crowds a narrow affordance without obvious payoff.

## Mobile rules (applies to every page)

- Breakpoints: **900px** (issue-page grid collapse), **640px** (typography shrink, chip wrap behavior).
- Tap targets ≥44×44px for every chip, theme, and sparkline row.
- Topic chips use `flex-wrap: wrap` with `gap: 0.5rem`. Never horizontal-scroll — chips on FLUX can reach 4 words and a scroll strip hides them.
- Density strip retains its aspect ratio at all widths. Existing Playwright bounding-box tests (`e2e/density-alignment.spec.ts`) must still pass on mobile viewports; add a `375×812` viewport case.
- `position: sticky` is desktop-only; removed below 900px so it doesn't fight the iOS address bar.
- `/topics` sparklines reflow: one year per line on <640px, 8–12 bars per line, no spaces between bars.
- The themes strip and issue-page chip row share one React/HTML component so mobile wrapping is tested once.

## API changes (additive — preserves response contract)

- `GET /issues/:id` — adds `topics: Array<{ keyword, keyword_display, score, rank }>` and `related_issues: Array<{ issue_id, issue_number, title, overlap }>`.
- `GET /latest-issue` — adds `topics` (top 3).
- `GET /search` — each result gains `topics: string[]` (top 3 for preview).
- `GET /topics` (new) — paginated corpus topics with timeline data.
- `GET /topics/:keyword` (new) — issues for that topic + timeline.

All additions are additive fields. The three query paths in `src/routes/search.ts` must all include the new `topics` field to preserve the Response-contract invariant documented in `docs/architecture.md`.

## Testing

- **Unit tests** (`test/topic-extractor.test.ts`): known-text fixtures with expected keyword sets; idempotency check.
- **PBT** (fast-check): determinism — `extract(text) === extract(text)` across 1000 random inputs; sort order monotonic in score.
- **Corpus tests** (`test/corpus-topics.test.ts`): run extraction across all 234 raw HTML files; assert each issue produces at least N topics; assert zero overlap with the boilerplate blocklist.
- **Integration tests**: call `POST /admin/rebuild-topics` against a seeded test DB, assert aggregate invariants (`doc_frequency <= total_issues`, `aggregate_score > 0`, no orphan `issue_topics`).
- **Relevance harness extension**: add 5 topic-driven queries with expected top results. Assert `topic:X` returns a subset of free-text search for `X` (topic is a stricter filter).
- **Visual regression**: Playwright snapshots of topic chips on issue page and landing-page theme strip.

## Risks / watchouts

- **Boilerplate contamination** — rely on normalizer + `doc_frequency` filter + blocklist.
- **Author/contributor names** — YAKE will surface them. Decide whether to treat as topics or route to a separate `issue_people` surface. Default: keep them; readers search for contributors.
- **n=3 ceiling** — misses 4-word phrases like "large language model agents". Test `n: 4`; revert if dedup noise rises.
- **Worker bundle size** — yaket bundles stopwords. Measure post-install; if heavy, gate import to ingest/reindex paths only, not the hot `search` route.
- **FTS5 interplay** — apostrophes that break FTS5 do NOT break YAKE or the `topic:` operator (parameterized bind). Ensure `topic:` is extracted from the query **before** FTS5 sanitization (see `src/routes/search.ts`).
- **Pipeline ordering** — topic extraction runs alongside embedding, both after chunking. It must not block `upsertIssue`; failures are logged and swallowed, matching the embedder's contract.

## Rollout order

1. Add `@ade_oshineye/yaket` dependency and `src/lib/topic-extractor.ts` with unit + PBT tests.
2. Migration `0006_topics.sql`.
3. Wire per-issue extraction into `rechunkAndEmbed`.
4. `POST /admin/rebuild-topics` + backfill path.
5. Corpus aggregator + timeline builder + blocklist support.
6. Weekly-cron integration.
7. API field additions to `/issues/:id`, `/latest-issue`, `/search`.
8. Frontend: issue-page chips → result-card subtitles → landing theme strip → `/topics` page → autocomplete.
9. `topic:` query operator in `query-parser.ts`.
10. Relevance harness entries for topic-driven queries.

## Appendix: page layouts

### Landing page — desktop

```
┌────────────────────────────────────────────────────────────────────┐
│  FLUX Review Search                                                 │
│  Search every issue of The FLUX Review                              │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│    "The quote from the latest issue goes here, pulled from          │
│     /latest-issue and rendered as a blockquote."                    │
│     — Issue #235 · 2026-04-11                                       │
│                                                                     │
│  ┌─────────────────────────────────────────────────┬──┐             │
│  │ Try "institutional trust" or issue:198 ...      │🔍│             │
│  └─────────────────────────────────────────────────┴──┘             │
│  Try: "institutional trust" · before:2024 · issue:198 · section:lens│
│                                                                     │
│      ┌─ Latest issue ────────────────────────────┐                  │
│      │ #235 · The Whatever Edition · 2026-04-11  │                  │
│      │ Topics: trust · legitimacy · civic repair │ ◄── NEW subtitle │
│      └───────────────────────────────────────────┘                  │
│                                                                     │
│  ┌─ Recurring themes ─────────────────────────────────────────┐ ◄── NEW
│  │  institutional trust   legitimacy   civic repair           │   top 12 from
│  │  large language models   AI safety   product strategy      │   corpus_topics
│  │  decision making   founder mode   network effects          │   by aggregate_score
│  │  ↑ font-size = log(doc_frequency), single hue              │   each → topic:"…"
│  └────────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────────────┘
```

### Landing page — mobile (≤640px)

```
┌───────────────────────┐
│ FLUX Review Search    │
│ Search every issue…   │
├───────────────────────┤
│ "The quote from the   │
│  latest issue goes…"  │
│  — #235 · 2026-04-11  │
│                       │
│ ┌─────────────────┬─┐ │
│ │ Try "inst…"     │🔍│ │
│ └─────────────────┴─┘ │
│ Try: "institutional   │
│  trust" · before:2024 │
│  · issue:198 · …      │
│                       │
│ ┌─ Latest issue ────┐ │
│ │ #235 · The Whate… │ │
│ │ 2026-04-11        │ │
│ │ Topics: trust ·   │ │
│ │  legitimacy ·     │ │
│ │  civic repair     │ │
│ └───────────────────┘ │
│                       │
│ ┌─ Recurring themes ┐ │
│ │ institutional     │ │ ◄─ one theme per
│ │  trust            │ │   line on narrowest
│ │ legitimacy        │ │   viewport; 2-col
│ │ AI safety         │ │   at ≥480px
│ │ civic repair      │ │
│ │ product strategy  │ │
│ │ …                 │ │
│ └───────────────────┘ │
└───────────────────────┘
```

### Search results — desktop

```
┌────────────────────────────────────────────────────────────────────┐
│ [search input ……………………………………………………………… 🔍] [x]                    │
│                                                                     │
│ Refine: section:lead_essay · year:2023 · topic:"institutional trust"│
│                                                                     │
│ ┌─ 47 results ─────────────────────────────────────────────────┐   │
│ │ 8 ┤ ██  ██    ██ ██ ██    ██ ██ ██ ██                        │   │
│ │   ├────────────────────────────────────                      │   │
│ │    '21 '22 '23 '24 '25 '26                                   │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ #214 · The Trust Edition · 2025-11-08          [section: lens]      │
│ …the failure of <mark>trust</mark> in institutions…                 │
│ Topics: institutional trust · legitimacy · civic repair  ◄── NEW    │
│                                                                     │
│ #198 · Eat the Frog · 2025-06-21            [section: lead_essay]   │
│ …only a radical rethink of public <mark>trust</mark>…               │
│ Topics: public trust · governance · AI safety            ◄── NEW    │
└────────────────────────────────────────────────────────────────────┘
```

Autocomplete is unchanged: history + operator hints, no topic suggestions.

### Search results — mobile

```
┌───────────────────────┐
│ [search ………… 🔍] [x]  │
│                       │
│ Refine:               │
│  section:lead_essay   │ ◄─ refine chips stack
│  year:2023            │   vertically; tap
│  topic:"inst. trust"  │   target ≥44px
│                       │
│ ┌─ 47 results ──────┐ │
│ │ 8┤██ ██ ██ ██     │ │
│ │  ├────────────    │ │
│ │   '21'22'23'24'25 │ │
│ └───────────────────┘ │
│                       │
│ #214 · The Trust      │
│  Edition              │
│ 2025-11-08            │
│ [lens]                │
│                       │
│ …the failure of       │
│  <mark>trust</mark>…  │
│                       │
│ Topics:               │ ◄─ topic line wraps
│  institutional trust  │   onto its own row
│  · legitimacy ·       │   (not inline with
│  civic repair         │   metadata)
└───────────────────────┘
```

### Issue page — desktop (side panel)

```
┌────────────────────────────────────────────────────────────────────┐
│ ← FLUX Review Search                                                │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Issue #214 · 2025-11-08                                            │
│  The Trust Edition                                                  │
│  Why institutional trust is the bottleneck for everything           │
│                                                                     │
│  ┌────────────────────────────────────────┐   ┌──────────────────┐ │
│  │  ─── Lead Essay ───                    │   │ Topics       ◄── │ │ ◄─ side panel
│  │  Full issue body renders here…         │   │ ───────────────  │ │   position:sticky
│  │  …                                     │   │ institutional    │ │   top:1rem
│  │  ─── Signposts ───                     │   │  trust           │ │   ~220px wide
│  │  …                                     │   │ legitimacy       │ │
│  │  ─── Lens ───                          │   │ civic repair     │ │
│  │  …                                     │   │ governance       │ │
│  │  ─── Book ───                          │   │ network effects  │ │
│  │  …                                     │   │ AI safety        │ │
│  │  ─── Postcard ───                      │   │ design trust     │ │
│  │  …                                     │   │ decision making  │ │
│  │                                        │   │                  │ │
│  │                                        │   │ ───────────────  │ │
│  │                                        │   │ Related issues   │ │ ◄─ same panel,
│  │                                        │   │ ───────────────  │ │   below topics
│  │                                        │   │ #198 · 4 shared  │ │
│  │                                        │   │ #171 · 3 shared  │ │
│  │                                        │   │ #142 · 3 shared  │ │
│  │   ← article column ~640px              │   └──────────────────┘ │
│  └────────────────────────────────────────┘   ← panel ~220px       │
└────────────────────────────────────────────────────────────────────┘
```

### Issue page — mobile (<900px collapses to stack)

```
┌───────────────────────┐
│ ← FLUX Review Search  │
├───────────────────────┤
│ Issue #214 · 2025-11  │
│ The Trust Edition     │
│ Why institutional     │
│  trust is the …       │
│                       │
│ ▼ Topics (8)          │ ◄─ side panel
│ ┌───────────────────┐ │   becomes inline
│ │ [inst. trust]     │ │   <details>,
│ │ [legitimacy]      │ │   collapsed by
│ │ [civic repair]    │ │   default to keep
│ │ [governance]      │ │   first paragraph
│ │ [network effects] │ │   above the fold
│ │ [AI safety]       │ │
│ │ [design trust]    │ │
│ │ [decision making] │ │
│ └───────────────────┘ │
│                       │
│ ─── Lead Essay ───    │
│ Full issue body       │
│  renders here…        │
│ …                     │
│ ─── Signposts ───     │
│ …                     │
│                       │
│ ▼ Related issues      │ ◄─ separate
│ ┌───────────────────┐ │   <details> at
│ │ #198 · 4 shared   │ │   bottom of
│ │ #171 · 3 shared   │ │   article
│ │ #142 · 3 shared   │ │
│ └───────────────────┘ │
└───────────────────────┘
```

### `/topics` page — desktop

```
┌────────────────────────────────────────────────────────────────────┐
│ FLUX Review Search · Topics                                         │
├────────────────────────────────────────────────────────────────────┤
│ Sort: [Frequency ▾] [Recency] [Alphabetical]                        │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────┐    │
│ │ institutional trust                              47 issues  │    │
│ │ '21 ▁▁▁▂▁▁ '22 ▁▂▃▂▁▁▁▃▄▂ '23 ▃▄▅▄█▇▆▅▄ '24 … '25 … '26 …  │    │
│ │ first seen 2021-08 · last seen 2026-04                      │    │
│ ├─────────────────────────────────────────────────────────────┤    │
│ │ large language models                            38 issues  │    │
│ │ '22 ▁▁▁▂▁▂▃▃▄▅▆ '23 █▇▆▅▄▅▆▇ '24 … '25 … '26 …              │    │
│ ├─────────────────────────────────────────────────────────────┤    │
│ │ civic repair                                     22 issues  │    │
│ │ '23 ▁▁▂▁▁▂▂▃ '24 ▆▅▄▅▆▇▆▅ '25 ▇▆▅▄▃▂ '26 …                  │    │
│ └─────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### `/topics` page — mobile

```
┌───────────────────────┐
│ FLUX · Topics         │
├───────────────────────┤
│ Sort:                 │
│ [Frequency ▾]         │ ◄─ sort becomes a
│                       │   single select
│ ┌───────────────────┐ │
│ │ institutional     │ │
│ │  trust            │ │
│ │            47 iss │ │
│ │ '21▁▂ '22▁▃▁▃     │ │ ◄─ sparkline
│ │ '23▃▅█▇ '24▅▆▇    │ │   reflows: one
│ │ '25▆▇█ '26▂       │ │   year per line,
│ │ 2021-08 → 2026-04 │ │   8-12 bars each
│ ├───────────────────┤ │
│ │ large language    │ │
│ │  models           │ │
│ │            38 iss │ │
│ │ '22▁▂▃▄ '23█▇▆▅   │ │
│ │ '24▄▅▆ '25▅▆ '26▂ │ │
│ └───────────────────┘ │
└───────────────────────┘
```
