# FLUX Review Search — High-Level Product Spec

## 1. Summary

Build a lightweight web app on Cloudflare Workers that provides high-quality search across all issues of **The FLUX Review**, including issues published before the move to Substack. The product must support both **literal / exact retrieval** and \*\*semantic retrie([read.fluxcollective.org](https://read.fluxcollective.org/sitemap?utm_source=chatgpt.com))se matches rank above results that only appear because of semantic similarity.

The system has two major parts:

1. **One-time bootstrap ingestion** to discover, crawl, normalize, and ingest all historical issues into Cloudflare D1 and Vectorize.
2. **User-facing search app** running on Cloudflare Workers with fast search, advanced operators, autocomplete, and clean issue detail pages.

This product should be designed to stay simple operationally: one Worker app, one D1 database, one Vectorize index, optional R2 for raw crawl artifacts, and a bootstrap ingestion flow that can be rerun idempotently if needed.

---

## 2. Goals

### Primary goals

- Search across **every FLUX Review issue**, regardless of whether it was published on Substack or on an earlier platform.
- Return strong results for:
  - exact term searches
  - phrase searches
  - concept / semantic searches
  - date-bounded searches
  - issue-number searches
- Provide a search UI that feels fast and forgiving.
- Keep infrastructure entirely on Cloudflare.

### Secondary goals

- Preserve raw source metadata so ingestion can be audited and rerun.
- Support future incremental reindexing for newly published issues.
- Make ranking logic explicit and tunable.

### Non-goals

- Full RAG/chat experience.
- Multi-tenant publishing platform.
- Editorial CMS.
- Heavy analytics or personalization in v1.

---

## 3. Product principles

- **Literal first, semantic second.** If the user types a phrase, phrase matches should dominate.
- **Complete archive coverage matters more than launch speed.** Missing historical issues breaks trust.
- **Simple architecture wins.** Prefer Worker + D1 + Vectorize over extra services.
- **Idempotent ingestion.** Re-running the bootstrap job must not create duplicates.
- **Operator transparency.** Advanced search syntax should be documented and predictable.

---

## 4. Users and use cases

### Core users

- FLUX readers looking for past issues by topic, concept, quote, or issue number.
- FLUX editors trying to find prior writing on a theme.
- Researchers browsing the publication over time.

### Primary use cases

- “Find issues about institutional trust.”
- “Show issues before 2024 about coordination problems.”
- “Find the issue with the phrase ‘just enough structure’.”
- “Show issue 198.”
- “Find older pre-Substack issues about systems thinking and commitment.”
- “Autocomplete my query as I type.”

---

## 5. Scope

### In scope for v1

- One-time historical crawl + ingest.
- Search page with advanced query operators.
- Result ranking using D1 FTS (BM25) + Vectorize hybrid retrieval.
- Issue detail page.
- Autocomplete for terms, operators, and issue numbers.
- Basic admin-only reindex endpoint.

### Out of scope for v1

- User accounts.
- Saved searches.
- Reader comments.
- Cross-publication search.
- AI-generated summaries.

---

## 6. Source discovery and ingestion strategy

### Current archive reality

The public evidence currently suggests that the FLUX Review archive is already substantially consolidated on Substack. The Substack sitemap exposes year-level archives going back to **2021**, and early episodes are available directly under `read.fluxcollective.org/p/<number>`.

This changes the default assumption for the project:

- do **not** assume there is a separate authoritative pre-Substack archive
- treat Substack as the **primary canonical source** unless coverage checks prove otherwise
- use legacy crawling only as a targeted fallback for missing issues, alternate URLs, or mirrored copies

### Known discovery sources

The bootstrap process should start with canonical, high-signal sources:

- Substack sitemap index
- year-level sitemap pages
- archive page
- homepage and about page
- direct numeric issue paths when needed for validation

### Discovery requirement

We do **not** need legacy crawling for this project.

The ingestion flow should treat the current Substack archive as the complete source of truth for issue discovery.

### Discovery policy

1. Start with sitemap-driven discovery for current archive coverage.
2. Crawl archive and homepage links for redundancy.
3. Validate continuity of issue numbers and publication dates.
4. Emit a “missing issues” report for manual review.
5. If gaps are detected, treat them as missing Substack issues to be retried from canonical Substack URLs only.

This is important because discovery completeness is a product requirement, not just an implementation detail.

## 7. Bootstrap crawler requirements

Use Cloudflare Browser Rendering’s ``** endpoint** as the one-time discovery and extraction mechanism.

### Why this fits

- It can crawl from a starting URL.
- It can discover URLs from **sitemaps**, **links**, or both.
- It can return **Markdown**, **HTML**, or **JSON**.
- It supports URL include/exclude patterns.
- It runs as a job, which is useful for large one-time archival ingestion.

### Bootstrap crawler responsibilities

- Accept one or more seed URLs.
- Run one or more crawl jobs with tailored parameters.
- Poll crawl job completion.
- Fetch results in pages.
- Store raw crawl artifacts for auditability.
- Normalize each candidate page into structured issue records.
- Upsert records into D1.
- Chunk and embed content for Vectorize.
- Emit a coverage report.

### Recommended crawl modes

#### Mode A: sitemap-first crawl

Use:

- `source: "sitemaps"`
- `formats: ["markdown", "html"]`
- `render: false` unless content requires JS
- include patterns restricted to FLUX issue URLs

Purpose:

- enumerate canonical issue pages quickly
- minimize noise and crawl cost
- establish the authoritative baseline corpus

This should be the **default and primary** bootstrap mode.

#### Mode B: archive/link crawl

Use:

- `source: "links"` or `"all"`
- archive page and homepage as seeds
- stricter include/exclude patterns

Purpose:

- catch pages missed by sitemap coverage
- validate internal-link discoverability

### Periodic update mode via Cloudflare Cron

After the one-time bootstrap, the dataset should be kept current with a **scheduled Worker** using Cloudflare Cron Triggers.

#### Scheduled update responsibilities

- run **once a week on Saturday**
- fetch the Substack sitemap index and relevant year sitemap(s)
- compare discovered episode URLs and metadata against D1
- identify episodes that are missing from the database
- download and ingest **only missing episodes**
- generate semantic chunks and embeddings only for those newly ingested episodes
- log the sync run and any failures

#### Recommended update strategy

- **Primary path:** sitemap diffing against D1, not full recrawl
- **Download behavior:** fetch and ingest only episodes missing from D1
- **Fallback path:** manual admin reindex for repairs or schema changes

This keeps routine maintenance cheap and predictable. The weekly cron job should not refresh already ingested episodes unless an admin explicitly runs a repair or reindex flow.

#### Scheduling recommendation

- run the scheduled sync **once a week on Saturday**
- keep the job lightweight and bounded to sitemap comparison plus missing-episode ingestion
- keep full bootstrap and repair flows as admin-only operations

### Crawl artifact retention

Store raw outputs in either:

- D1 metadata + compressed body fragments, or
- R2 objects with D1 metadata pointers

Preferred approach:

- **R2 for raw artifacts**, **D1 for normalized searchable records**

This keeps D1 focused on query-serving data while preserving replayable source material.

---

## 8. Normalization pipeline

Each crawled page should be normalized into one of these content types:

- `issue`
- `non_issue_post`
- `junk / ignore`

### Issue extraction fields

For each issue record:

- `id` (internal UUID)
- `issue_number` (nullable for edge cases)
- `title`
- `subtitle` (nullable)
- `published_at`
- `source_url`
- `canonical_url`
- `source_platform` (`substack`, `legacy`, `unknown`)
- `authors`
- `contributors`
- `summary`
- `full_text_markdown`
- `full_text_plain`
- `cover_image_url` (nullable)
- `crawl_job_id`
- `content_hash`
- `ingested_at`
- `word_count`
- `status`

### Derived fields

- `year`
- `month`
- `slug`
- `search_text`
- `has_semantic_chunks`

### Parsing rules

- Prefer canonical issue number if present.
- Prefer issue publish date over crawl date.
- Strip navigation, subscription prompts, footer boilerplate, and discussion widgets.
- Preserve headings and section boundaries.
- Preserve quoted text.
- Normalize Unicode and whitespace.

### Deduplication rules

Two pages are duplicates if they share one or more of:

- canonical URL
- issue number + publish date
- strong content hash similarity

When duplicates are found:

- retain the canonical record
- keep alias URLs in a separate mapping table

---

## 9. Data model

### D1 tables

#### `issues`

Primary issue record.

#### `issue_aliases`

Maps legacy or alternate URLs to canonical issue IDs.

Fields:

- `alias_url`
- `issue_id`
- `source_platform`

#### `issue_chunks`

Chunked text units used for semantic indexing.

Fields:

- `id`
- `issue_id`
- `chunk_index`
- `section_label`
- `chunk_text`
- `token_estimate`
- `content_hash`

#### `crawl_runs`

Tracks bootstrap and reindex runs.

Fields:

- `id`
- `seed_url`
- `mode`
- `started_at`
- `completed_at`
- `status`
- `records_found`
- `issues_created`
- `issues_updated`
- `issues_skipped`
- `notes`

#### `query_logs` (optional, v1.1)

For ranking evaluation and autocomplete improvement.

---

## 10. Full-text search design in D1

Use D1’s SQLite FTS5 support for lexical retrieval.

### FTS strategy

Create an FTS virtual table over selected searchable fields:

- title
- subtitle
- summary
- section headings
- full body text
- contributor names

### Weighting

Weight fields so title and headings matter more than body text. Suggested importance order:

1. issue number exact match
2. title / phrase match
3. heading match
4. summary match
5. body match
6. contributor match

### FTS capabilities to expose

- exact term search
- quoted phrase search
- boolean operators
- prefix matching where appropriate
- field-scoped search in limited form

### Autocomplete support

Use one or both:

1. FTS5 prefix indexes for fast prefix query support
2. `fts5vocab`-based term lookup for suggested completions

Autocomplete should not attempt full natural-language prediction. It should be deterministic, cheap, and tied to indexed corpus terms plus supported operators.

---

## 11. Vector search design with Vectorize

Use Vectorize for semantic retrieval over chunks, not entire issues.

### Chunking strategy

Chunk each issue into semantically coherent passages:

- target \~300–800 tokens per chunk
- keep section boundaries where possible
- overlap lightly between adjacent chunks

### What gets embedded

Embed:

- title + summary as one chunk
- each body chunk
- optionally section headings appended to the chunk text

### Vector metadata

For each vector:

- `chunk_id`
- `issue_id`
- `issue_number`
- `published_at`
- `title`
- `section_label`
- `source_platform`

### Retrieval rule

Vectorize returns chunk-level matches. The app should then:

- map chunk hits back to issues
- aggregate per-issue scores
- preserve top supporting chunk for snippet display

---

## 12. Hybrid ranking, fusion, and reranking

This is the core product behavior.

### Retrieval stages

1. Parse query into:
   - free text
   - quoted phrases
   - operators
   - filters
2. Apply hard filters that can be enforced early.
3. Run D1 FTS query.
4. Run Vectorize semantic query.
5. Normalize both result sets into issue-level candidates.
6. Fuse lexical and semantic rankings.
7. Apply deterministic reranking boosts and penalties.
8. Return a single ranked result list.

### Ranking principles

- Exact issue-number match should be near the top.
- Exact phrase matches should outrank semantic-only matches.
- Dense semantic matches should rescue concept queries and vocabulary mismatch.
- Date filters must apply before final ranking.
- Duplicate issue results from multiple chunks must collapse into one issue result.
- Lexical precision should dominate when lexical evidence is strong.

### Retrieval sources

#### Lexical retrieval from D1 FTS

Use D1 FTS as the primary source of truth for:

- exact term matches
- quoted phrase matches
- issue-number lookups
- title and heading matches
- field-aware literal relevance

#### Semantic retrieval from Vectorize

Use Vectorize for:

- concept matches
- vocabulary mismatch recovery
- related thematic retrieval
- long-form similarity at the chunk level

Vector hits are chunk-level and must be collapsed back to issue-level candidates before reranking.

### Score normalization

Raw BM25-style lexical scores and vector similarity scores are not directly comparable. Do **not** add them directly.

Instead:

- convert each retrieval result set into a ranked list
- retain top-k candidates from each source
- fuse by rank rather than by raw score

### Fusion method

Use **weighted reciprocal rank fusion** as the default hybrid merge strategy.

Conceptually:

- lexical rank contributes more than semantic rank
- high positions matter much more than low positions
- a result surfaced by both systems gets compounded credit

Example conceptual formula:

```text
fusion_score(issue) =
  lexical_weight * (1 / (k + lexical_rank))
  + semantic_weight * (1 / (k + semantic_rank))
```

Recommended defaults:

- `lexical_weight = 1.0`
- `semantic_weight = 0.55`
- `k = 20` to `60`, tuned empirically

This makes lexical retrieval the dominant signal while still allowing semantic retrieval to surface strong concept matches.

### Deterministic reranking layer

After fusion, apply explicit boosts and penalties at the **issue level**.

#### Strong boosts

- exact `issue:NUMBER` match
- exact quoted phrase match in title
- exact quoted phrase match in subtitle or headings
- exact quoted phrase match in body

#### Medium boosts

- strong title token overlap
- heading match
- summary match
- lexical and semantic agreement on the same issue
- multiple chunk hits pointing to the same issue

#### Penalties or suppressions

- semantic-only result when strong lexical matches exist
- weak chunk-only match with little issue-level support
- duplicate or low-information issue records

### Hard reranking rule

If a result appears only from Vectorize and another result has a strong lexical or phrase match, the lexical result should rank higher.

This is the key behavioral requirement for product quality.

### Issue-level candidate collapse

Vectorize may return multiple chunk hits for the same issue. The reranker must:

- collapse them into one issue result
- retain the highest-signal chunk for snippet display
- optionally add a small boost for multiple independent supporting chunks

### Suggested issue-level scoring model

A simple, explicit scoring model is preferred over an opaque ML reranker in v1.

Conceptual scoring shape:

```text
final_score(issue) =
  fusion_score
  + exact_issue_boost
  + phrase_title_boost
  + phrase_heading_boost
  + phrase_body_boost
  + title_overlap_boost
  + lexical_semantic_agreement_boost
  + multi_chunk_support_boost
  - semantic_only_penalty_when_lexical_is_strong
```

### Suggested starting weights

These are tuning defaults, not fixed constants.

- `exact_issue_boost = +10.0`
- `phrase_title_boost = +6.0`
- `phrase_heading_boost = +4.0`
- `phrase_body_boost = +3.0`
- `title_overlap_boost = +1.5`
- `lexical_semantic_agreement_boost = +1.25`
- `multi_chunk_support_boost = +0.5` to `+1.0`
- `semantic_only_penalty_when_lexical_is_strong = -2.5` to `-5.0`

These should be tuned against a small hand-labeled relevance set.

### Pseudocode

```ts
function rankSearchResults(query) {
  const parsed = parseQuery(query)
  const filters = parsed.filters

  const lexical = searchFts(parsed.lexicalQuery, filters)
  const semantic = searchVectorize(parsed.semanticQuery, filters)

  const lexicalRanks = rankByPosition(lexical)
  const semanticIssueCandidates = collapseChunksToIssues(semantic)
  const semanticRanks = rankByPosition(semanticIssueCandidates)

  const candidates = unionByIssueId(lexical, semanticIssueCandidates)

  for (const issue of candidates) {
    let score = 0

    score += weightedRrfRank(lexicalRanks[issue.id], 1.0)
    score += weightedRrfRank(semanticRanks[issue.id], 0.55)

    if (isExactIssueMatch(issue, parsed)) score += 10.0
    if (hasQuotedPhraseInTitle(issue, parsed)) score += 6.0
    if (hasQuotedPhraseInHeading(issue, parsed)) score += 4.0
    if (hasQuotedPhraseInBody(issue, parsed)) score += 3.0
    if (hasStrongTitleOverlap(issue, parsed)) score += 1.5
    if (appearsInLexicalAndSemantic(issue, lexicalRanks, semanticRanks)) score += 1.25
    if (hasMultipleSupportingChunks(issue)) score += 0.75

    if (isSemanticOnly(issue, lexicalRanks) && hasStrongLexicalCompetition(lexical)) {
      score -= 3.5
    }

    issue.finalScore = score
  }

  return sortDescending(candidates, i => i.finalScore)
}
```

### Explainability and debugging

Each result should carry internal debug metadata:

- `matched_by: [fts, vector, phrase, issue_number]`
- `lexical_rank`
- `semantic_rank`
- `top_chunk_section`
- `applied_boosts`
- `applied_penalties`
- `final_score`

This does not need to be user-visible in v1, but it should be available in admin or debug mode.

### Why not use an LLM or cross-encoder reranker in v1

Do not use an LLM reranker in v1.

Reasons:

- adds latency and cost
- makes ranking behavior harder to reason about
- is unnecessary for a corpus of this shape
- weakens the hard requirement that phrase and literal matches win predictably

The v1 reranker should remain deterministic, transparent, and easy to tune.

## 13. Search operators

Operators should be simple, memorable, and intentionally limited.

### Required operators

- `before:YYYY-MM-DD`
- `after:YYYY-MM-DD`
- `year:YYYY`
- `issue:NUMBER`
- `source:substack`
- `source:legacy`
- quoted phrases, e.g. `"just enough structure"`

### Nice-to-have operators

- `title:TERM`
- `author:NAME`
- `contributor:NAME`
- `has:image`

### Query examples

- `institutional trust after:2024-01-01`
- `"just enough structure"`
- `issue:198`
- `coordination before:2023-01-01 source:legacy`
- `title:commitment after:2025-01-01`

### Operator behavior rules

- Invalid operators should be ignored but surfaced in UI feedback.
- Invalid dates should not crash the query.
- `before` and `after` are inclusive or exclusive by spec choice; choose one and document it consistently.

Recommended:

- `before:` = strictly earlier than the given date
- `after:` = strictly later than the given date

---

## 14. Autocomplete

Autocomplete should support three categories:

### 1. Operator suggestions

Examples:

- `before:`
- `after:`
- `issue:`
- `year:`
- `source:`

### 2. Corpus term suggestions

Backed by indexed vocabulary and popular title phrases.

### 3. Entity suggestions

- issue numbers
- contributor names
- common title starts

### UX rules

- show suggestions after 2–3 characters
- keyboard navigable
- do not block search submission
- respect quoted phrase context when possible

---

## 15. User experience

### Main search page

Components:

- single prominent search input
- operator hint text
- autocomplete dropdown
- result count
- optional filter chips reflecting parsed operators

### Result card

Each result should show:

- issue title
- issue number
- publish date
- source badge (`Substack` or `Legacy`)
- short snippet
- optional matched section label
- URL to full issue page

### Issue detail page

- normalized title and metadata
- clean rendered body
- canonical source link
- optional “matched sections” anchors

### Empty states

- suggest removing a filter
- suggest broadening date range
- show example operators

---

## 16. API surface

### Public endpoints

- `GET /search?q=...`
- `GET /autocomplete?q=...`
- `GET /issues/:id`
- `GET /issues/issue/:number`

### Admin endpoints

- `POST /admin/bootstrap`
- `POST /admin/reindex`
- `GET /admin/crawl-runs/:id`
- `GET /admin/coverage`

### Response shape for `/search`

- parsed query
- applied filters
- total hits
- results[]
  - issue id
  - title
  - issue number
  - publish date
  - snippet
  - canonical URL
  - matched\_by

---

## 17. Suggested architecture

### Runtime components

- **Cloudflare Worker**: web app + API + ranking orchestration
- **D1**: normalized issue metadata, FTS index, autocomplete metadata
- **Vectorize**: semantic chunk embeddings
- **Workers AI**: embedding generation
- **R2**: optional raw crawl artifacts and ingest logs

### Flow

1. Bootstrap Worker job starts crawl.
2. Crawl results fetched and normalized.
3. Issues upserted into D1.
4. Chunks generated and embedded.
5. Vectors upserted into Vectorize.
6. Search Worker serves hybrid retrieval queries.

---

## 18. Operational requirements

### Idempotency

All ingest operations must be safe to rerun.

### Scheduled maintenance

The system should support ongoing archive freshness through **Cloudflare Cron** on the Worker.

Recommended jobs:

- **weekly Saturday sync job**: checks the sitemap for episodes present on Substack but missing from D1, then ingests only those missing episodes
- **manual admin reindex job**: used for schema changes, parser upgrades, or data repair

There is no legacy crawl job in scope.

Cron jobs must be:

- idempotent
- bounded in runtime and batch size
- safe to resume after partial failure
- observable through sync-run logs and status endpoints

### Observability

Track:

- crawl jobs started/completed/failed
- pages discovered
- pages normalized
- issues created/updated/skipped
- chunk counts
- embedding failures
- scheduled sync runs started/completed/failed
- search latency
- lexical vs semantic hit ratios

### Failure handling

- partial crawl failure should not poison the archive
- malformed pages should be quarantined, not dropped silently
- vector indexing failures should be retryable independently of D1 upserts
- scheduled sync failures should surface alerts and preserve a retry path

### Coverage auditing

Admin coverage page should answer:

- how many issues discovered total
- first/last issue by date
- missing issue numbers
- duplicate candidates
- pages ignored and why
- whether scheduled sync is healthy

## 19. Performance targets

### Search

- autocomplete p95 under 150 ms
- search p95 under 500 ms for normal corpus size
- issue page render p95 under 300 ms from cacheable path

### Bootstrap

- one-time ingestion may take materially longer
- correctness beats speed

---

## 20. Security and abuse considerations

- Admin endpoints require auth.
- Search endpoints rate-limited.
- Query parser must avoid raw SQL composition.
- All D1 access via prepared statements.
- Operator parsing must reject pathological input sizes.

---

## 21. Testing strategy

### Ingestion tests

- issue pages normalize correctly
- duplicates collapse correctly
- legacy aliases map correctly
- missing issues report is generated

### Search tests

- phrase queries beat semantic-only matches
- `before:` and `after:` filters work correctly
- `issue:` exact lookup works
- quoted phrase behavior is stable
- autocomplete returns deterministic results

### Relevance tests

Create a small hand-labeled evaluation set of representative queries:

- exact phrase
- broad concept
- issue number
- contributor name
- date-bounded query

Use this set to tune:

- lexical weights
- fusion weights
- final deterministic boosts

---

## 22. Rollout plan

### Phase 1 — archive bootstrap

- implement crawl runner
- ingest current Substack archive
- ingest legacy seeds
- produce coverage report

### Phase 2 — internal search

- ship search API
- validate ranking with internal queries
- tune blending and phrase boosts

### Phase 3 — public UI

- launch search page and issue detail pages
- add autocomplete and operator help

### Phase 4 — incremental maintenance

- add Cloudflare Cron-triggered Saturday sync
- diff sitemap contents to detect episodes missing from D1
- ingest and embed only the missing episodes
- keep validation and repair as admin workflows

## 23. Open questions

- Should `before:` / `after:` be strict or inclusive?
- Should the UI expose source filtering in controls, or keep it operator-only?
- Do we want snippets from the best lexical match or the best semantic chunk when both exist?
- What cron frequency gives the right tradeoff between freshness and cost?

## 24. Recommendation on skills

The implementation work should explicitly reference and use `` as a project skill / knowledge source for Cloudflare platform implementation details.

Why include it in the spec:

- this project spans multiple Cloudflare products
- the skill covers Workers, D1, Vectorize, Browser Rendering, and related patterns
- it provides a shared implementation reference for engineers and coding agents

Expected use in this project:

- Worker setup and bindings
- D1 schema and migration guidance
- Vectorize integration patterns
- Browser Rendering crawl endpoint usage
- Cloudflare-specific gotchas and deployment guidance

This should be called out as an implementation aid, not as runtime infrastructure.

---

## 25. Ship criteria

The product is ready for v1 launch when:

- archive coverage has been audited and approved
- search supports exact, phrase, semantic, and date-bounded queries
- autocomplete is live
- lexical matches reliably outrank semantic-only matches
- admin can rerun ingest safely
- p95 latency is acceptable
- top relevance tests pass

---

## 26. Final recommendation

Build this as a **hybrid archive search app** on Cloudflare, with a **sitemap-first bootstrap crawler**, a **D1 FTS5 lexical index**, a **Vectorize semantic chunk index**, and a **Worker-side fusion layer** that makes literal and phrase matches win unless semantic retrieval is clearly more relevant.

Keep the archive fresh with a **Cloudflare Cron-driven weekly Saturday sync** that diffs the Substack sitemap against D1 and downloads only episodes that are missing from the database.

That gets you the thing you actually want: a search experience that is broad enough to recover old knowledge, but precise enough not to feel like AI sludge.


