# Yaket Topic Extraction Specification

Extract key topics (words and phrases) from each issue of The FLUX Review and from the overall corpus, then surface them across the site as chips, filters, facets, and a dedicated topics page.

## Motivation

Search today is lexical + semantic over chunks. Readers have no way to ask "what does FLUX talk about?" at a glance — there is no topical spine. Topics give us:

- Per-issue chips that make each issue scannable.
- A corpus-wide theme list that answers "what has FLUX been about for 5 years?"
- A new `topic:` query operator that complements free-text search.
- Autocomplete suggestions rooted in real editorial content, not canned examples.
- Related-issue links via topic overlap.

## Library

[`@ade_oshineye/yaket@0.4.0`](https://www.npmjs.com/package/@ade_oshineye/yaket) — a TypeScript port of YAKE with a `/worker` entry point, fully bundled stopwords, and no network dependency. Runs inside Cloudflare Workers.

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

Three levels, all derived from the same `extract()` function:

| Scope | Input | Storage | When computed |
|---|---|---|---|
| **Chunk/section** | `issue_chunks.chunk_text` | `issue_topics` with `section_label` set | During `rechunkAndEmbed` |
| **Issue** | `issues.full_text_plain` | `issue_topics` with `section_label = NULL` | During `ingestPage` |
| **Corpus** | aggregation over `issue_topics` | `corpus_topics`, `topic_timeline` | Cron + admin route |

Section-level extraction is recommended: a four-line Book recommendation's author is buried in whole-issue extraction, and it feeds the existing `section:` facet.

## Data model

Migration `migrations/0006_topics.sql`:

```sql
CREATE TABLE issue_topics (
  issue_id       TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  keyword        TEXT NOT NULL,           -- normalized: lowercased, punctuation stripped
  keyword_display TEXT NOT NULL,          -- original casing, for UI
  score          REAL NOT NULL,           -- YAKE score (lower = better)
  rank           INTEGER NOT NULL,        -- 1..top_n within scope
  ngram_size     INTEGER NOT NULL,
  section_label  TEXT,                    -- NULL for whole-issue; otherwise chunk section
  PRIMARY KEY (issue_id, keyword, section_label)
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

Optional FTS5 virtual table over `corpus_topics(keyword_display)` for topic autocomplete.

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
  section_label: string | null;
}

export function extractTopics(
  text: string,
  section_label: string | null = null,
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
    section_label,
  }));
}
```

Wire into `rechunkAndEmbed` (`src/crawler/ingestor.ts`), next to the embedder call, treated as best-effort like embedding:

```ts
try {
  const issueTopics = extractTopics(issue.full_text_plain);
  const sectionTopics = chunks.flatMap(c =>
    extractTopics(c.chunk_text, c.section_label, { top: 8 })
  );
  await replaceIssueTopics(env.DB, issue.id, [...issueTopics, ...sectionTopics]);
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
WHERE t.section_label IS NULL
  AND t.keyword NOT IN (SELECT keyword FROM topic_blocklist)
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
WHERE t.section_label IS NULL
GROUP BY t.keyword, i.year, i.month;
```

Scale: 234 issues × ~25 topics = ~6k rows. Single D1 transaction, no batching needed.

### Triggers

| Trigger | Action |
|---|---|
| `ingestPage` | Per-issue + per-chunk extraction for that issue |
| `runReindex` | Walks all issues → rebuilds `issue_topics` |
| `POST /admin/rebuild-topics` | Backfill + aggregate; `?backfill=true` re-extracts every issue |
| Weekly cron (`src/cron/weekly-sync.ts`) | Calls `rebuild-topics` after ingest |

### Backfill

`POST /admin/rebuild-topics?backfill=true` walks every issue, extracts, upserts, then aggregates. Idempotent because YAKE is deterministic.

## Surfacing on the website

### Issue page (`frontend/issue.html`)
- Row of up to 8 topic chips under the title. Click → search with `topic:"…"`.
- Collapsible "Topics by section" panel reusing `--section-lead-essay` etc. colors.
- "Issues sharing these topics" strip: Jaccard over top-10 keyword sets.

### Search result cards (`frontend/js/app.js`)
- One subtitle line: "Topics: trust · legitimacy · civic repair" (top 3 from `issue_topics`).
- Improves scannability for queries that span sections.

### `topic:` query operator (`src/lib/query-parser.ts`)
- `topic:"institutional trust"` → `WHERE EXISTS (SELECT 1 FROM issue_topics WHERE issue_id = issues.id AND keyword = ?)`.
- Cheaper than FTS5 MATCH, so it can combine with free-text queries.
- Exempt from the FTS5 sanitizer — parameterized binds only.

### Landing page
- "Recurring themes" strip above the example queries: top 12 corpus topics by `aggregate_score`.
- Tufte-friendly rendering: font size proportional to `log(doc_frequency)`, single hue — no word cloud bubbles.

### `/topics` page (new)
- Sortable full list: frequency / recency / alphabetical.
- Per-topic sparkline from `topic_timeline` showing month/year distribution — matches density-strip aesthetic.
- Click-through → filtered search.

### Autocomplete
- Extend the existing `autocomplete-dropdown` to suggest from `corpus_topics.keyword_display`, ranked by `aggregate_score`.

## API changes (additive — preserves response contract)

- `GET /issues/:id` — adds `topics: Array<{ keyword, score, rank, section_label }>`.
- `GET /latest-issue` — adds `topics`.
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
3. Wire per-issue + per-section extraction into `rechunkAndEmbed`.
4. `POST /admin/rebuild-topics` + backfill path.
5. Corpus aggregator + timeline builder + blocklist support.
6. Weekly-cron integration.
7. API field additions to `/issues/:id`, `/latest-issue`, `/search`.
8. Frontend: issue-page chips → result-card subtitles → landing theme strip → `/topics` page → autocomplete.
9. `topic:` query operator in `query-parser.ts`.
10. Relevance harness entries for topic-driven queries.
