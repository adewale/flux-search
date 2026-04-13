# How we built search

This document explains the reasoning behind the search system in flux-search. It's written for someone building hybrid search on a similar stack (Cloudflare Workers + D1 + Vectorize) who wants to understand not just what we did, but why.

## The problem

We have the full FLUX Review newsletter archive (published weekly since 2021). Each issue is 2,000-5,000 words with a recurring internal structure: opening quote, lead essay, signposts, lens of the week, book recommendations, postcards. Users want to find specific ideas, phrases, and topics across this archive.

A newsletter archive is an awkward size for search. It's too small for web-scale techniques (no PageRank, no click signals) but too large to browse manually. Every query has a small candidate pool, so ranking precision matters more than recall.

## Why hybrid search

We use two search signals and combine them:

**Lexical search (D1 FTS5)** finds exact text matches. If you search for "institutional trust", it finds issues containing those exact words. It's fast, predictable, and handles operators like `before:2024` naturally. But it misses semantic connections -- searching for "organizational credibility" won't find "institutional trust" even though they discuss the same concept.

**Semantic search (Vectorize)** finds meaning-similar content. The query is embedded into a 768-dimensional vector using `bge-base-en-v1.5`, then compared against pre-computed vectors for every chunk of every issue. It finds conceptual matches that share no words with the query. But it's noisy -- it always returns results, even when none are relevant, and it can't handle operators or exact phrases.

Neither signal is sufficient alone. Lexical search is precise but brittle. Semantic search is flexible but noisy. Combining them gives us precision on exact matches and discovery on conceptual ones.

## Lexical search: FTS5 and BM25

D1 provides SQLite's FTS5 extension, which indexes text and ranks results using BM25 (a term frequency / inverse document frequency algorithm). We index six fields with different weights:

```
bm25(issues_fts, 16.0, 8.0, 8.0, 4.0, 1.0, 2.0)
```

| Field | Weight | Reasoning |
|-------|--------|-----------|
| title | 16.0 | A term in the title is the strongest signal. The title is short, so every word is intentional. |
| subtitle | 8.0 | Lead essay titles are specific and editorial. Half the signal of the main title. |
| headings | 8.0 | Section headings name the topic of a section. Same weight as subtitle. |
| summary | 4.0 | Summaries are editorial descriptions of the issue. Relevant but less specific. |
| full_text_plain | 1.0 | Body text is long, so any single term match is weak. This is the baseline. |
| contributors | 2.0 | Contributor names are occasionally useful but not a primary search signal. |

The ratio matters more than the absolute values. Title matches are 16x more valuable than body matches. This prevents long issues from outranking short ones just because they contain more words.

### Highlighting

FTS5 provides a `snippet()` function that extracts text around the matching terms and wraps them in `<mark>` tags. This is important for UX -- the user can see *why* a result matched, not just *that* it matched.

```sql
snippet(issues_fts, 4, '<mark>', '</mark>', '...', 24)
```

Column 4 is `full_text_plain`. We show up to 24 tokens of context around each match. The highlight is passed through to the frontend, where a sanitiser preserves `<mark>` tags while escaping everything else.

## Semantic search: chunking, embedding, collapsing

Vectorize stores vectors, not documents. An issue is too long to embed as a single vector (the embedding model has a ~512 token context window, and longer texts lose specificity). So we split each issue into chunks.

### Chunking strategy

Each issue is split into chunks of 300-800 tokens (1,200-3,200 characters):

- **Chunk 0** is always `title + summary`. This is a fixed, high-signal chunk that represents the issue as a whole.
- **Body chunks** respect section boundaries. A lead essay chunk stays within the lead essay. This means the chunk's `section_label` is meaningful -- you know which part of the issue the match came from.
- **Overlap**: each chunk starts 200 characters before the previous chunk ended. This prevents the retrieval boundary problem where a relevant passage is split across two chunks and neither chunk ranks highly enough on its own.

When a section is too long for one chunk, we split at paragraph boundaries first, then sentence boundaries, then word boundaries. This preserves readability of the chunk text, which matters because chunks become snippets in search results.

### Why these sizes?

- **300 tokens minimum**: shorter chunks match too broadly. A 50-token chunk like "trust is fundamental to institutions" would match almost any query about trust, institutions, or fundamentals -- too noisy.
- **800 tokens maximum**: the embedding model's effective context is ~512 tokens. Longer chunks dilute the signal. Also, longer chunks make worse snippets.
- **50 tokens overlap**: enough to capture a sentence that spans a boundary, without duplicating significant content.

### Collapsing chunk results to issues

Vectorize returns chunk-level results. But the user wants to see issues, not chunks. We collapse by issue:

1. Query Vectorize for the top 50 chunks by cosine similarity.
2. Group by `issue_id`.
3. For each issue, keep the highest-scoring chunk's text and section label (this becomes the snippet).
4. Track the chunk count per issue (used for a ranking boost later -- multiple matching chunks are a stronger signal than one).
5. Sort by the top score and assign ranks.

Date filters (`before:`, `after:`, `year:`) can't be pushed into the Vectorize query, so they're applied after collapsing. This is less efficient than filtering at the index level, but with a small corpus the cost is negligible.

## Fusing the two signals: reciprocal rank fusion

We now have two ranked lists: one from FTS5, one from Vectorize. How do we combine them?

The naive approach -- normalising and averaging the raw scores -- doesn't work because BM25 scores and cosine similarities are on incompatible scales. A BM25 score of 15.0 and a cosine similarity of 0.82 can't be meaningfully averaged.

**Reciprocal Rank Fusion (RRF)** solves this by ignoring scores entirely and using only the rank position:

```
rrf_score = lexical_weight / (k + lexical_rank) + semantic_weight / (k + semantic_rank)
```

- `lexical_weight = 1.0`, `semantic_weight = 0.55` (defaults; tunable via env vars) -- FTS gets roughly twice the influence
- `k = 40` (defaults; tunable via env vars) -- a smoothing constant that controls how much rank position matters

The `k` parameter determines how steeply the score drops with rank. With `k=40`, rank 1 scores `1/41 = 0.0244` and rank 10 scores `1/50 = 0.02` -- a gentle decline. With `k=1`, rank 1 scores `1/2 = 0.5` and rank 10 scores `1/11 = 0.09` -- much steeper. A higher `k` makes the fusion more democratic (lower ranks still contribute); a lower `k` makes it more winner-take-all.

### Why weight lexical higher?

For a text archive, exact matches are almost always what the user wants. If someone types "decision treadmill", they want the issue titled "The decision treadmill", not a semantically related essay about choice overload. Lexical search finds the exact match; semantic search finds the related one. Weighting lexical at 1.0 vs semantic at 0.55 means the exact match wins, but the related result still appears.

The weights are exposed as environment variables (`LEXICAL_WEIGHT`, `SEMANTIC_WEIGHT`, `RRF_K`) so they can be tuned without redeploying. For a corpus where exact terminology is less important (e.g., conversational content), you'd increase the semantic weight.

## Deterministic reranking: the boost system

RRF produces a base ranking. We then apply deterministic boosts that encode domain knowledge about what makes a good result:

See the boost table in docs/architecture.md for current values.

The boosts are additive. An issue matching a quoted phrase in its title gets `+6.0`, which at the scale of RRF scores (typically 0.01-0.05) is a decisive promotion.

### The semantic-only penalty

This is the most important non-obvious decision. Without it, searching for "qwan" (a specific term from one issue) returns five semantically-related-but-irrelevant results from Vectorize alongside the one correct FTS match. The irrelevant results have confident-looking scores because cosine similarity always returns something.

The penalty applies only when there are 3 or more FTS results (so the lexical signal is strong) and the result appeared only in the Vectorize set (no FTS confirmation). The -3.5 value pushes these results below confirmed matches but doesn't remove them entirely -- they still appear, just ranked lower.

## Quality controls

### Semantic score threshold

Vectorize always returns results, even for nonsense queries. Without a floor, low-similarity matches pollute results with noise. We set `SEMANTIC_MIN_SCORE = 0.75` -- any vector result with cosine similarity below 0.75 is dropped before ranking.

We arrived at 0.75 empirically. At 0.7, too many weakly-related results appeared. At 0.8, legitimate conceptual matches were filtered out. The right threshold depends on the embedding model and corpus -- `bge-base-en-v1.5` with newsletter text clusters at 0.75-0.85 for genuine matches.

### Confidence tiers

Results are classified into three confidence levels, which the frontend renders with different visual weight:

- **High**: exact issue match, or quoted phrase found in title/headings/body. The system is confident this is what the user wanted.
- **Medium**: matched via term overlap, cross-signal agreement, or other boosts. Likely relevant.
- **Low**: penalised semantic-only result. Shown at reduced opacity so the eye skips to stronger matches.

This is a Tufte principle: use visual weight to encode data. A user scanning 20 results should be drawn to the high-confidence ones without reading every card.

### Progressive snippet disclosure

The top 3 results get 400-character snippets. All others get 150 characters. This follows the information-seeking principle that users evaluate the first few results carefully and scan the rest. Longer snippets at the top help the user decide whether to click; shorter snippets below reduce visual noise.

## What went wrong

These are real bugs we hit. Each one taught us something about the gap between "search works" and "search works well."

### Semantic search silently returned nothing

For the first several deploys, Vectorize never contributed a result. The cause: we set `returnMetadata: 'indexed'` in the Vectorize query. Without metadata indexes configured, this returned empty metadata for every vector -- so the ranker had no issue IDs to match against. FTS results filled in, so the search "worked." The fix was changing one word to `'all'`.

**Lesson**: test that both signals actually contribute. Add a `matched_by` field to results and check it in your tests. We added `debug=true` mode to the search API that exposes which signals matched each result.

### Every result looked the same

All 234 issues originally had titles like "The FLUX Review, Ep. 198". Every result card showed an identical title. The ranking was correct (phrase matches beat semantic-only) but invisible because the display was undifferentiated.

**Lesson**: search quality is a function of ranking *and* display. We extracted the lead essay title from each issue ("The decision treadmill" instead of "The FLUX Review, Ep. 230") and the problem disappeared. The ranking didn't change; the UX did.

### "qwan" returned five irrelevant results

The term "qwan" appears in exactly one issue. FTS correctly found it. But Vectorize also returned five semantically-similar-but-irrelevant results about quality and craftsmanship. Without the semantic-only penalty, these five results appeared alongside the correct one with similar visual weight.

**Lesson**: semantic search always returns something. If your corpus is small, the "most similar" result might still be completely irrelevant. The penalty system and score threshold exist because of this query.

### Snippets showed boilerplate, not content

Early snippets showed Substack subscription prompts, image URLs, and attribution lines instead of the text that matched the query. The `cleanContent` function stripped these from plain text but not from the markdown used for FTS indexing.

**Lesson**: the snippet is the most important part of a search result. Clean your indexed text aggressively. Anything that appears in your index can appear in a snippet.

## Tuning for a different corpus

If you're adapting this approach for a different newsletter or content archive:

1. **Start with lexical-only search.** Get FTS5 working, tune your BM25 weights, and verify that exact queries return the right results. Add semantic search only after lexical results are solid.

2. **Adjust BM25 weights for your content structure.** Our title weight (16x body) assumes short, editorial titles. If your titles are generated or formulaic, reduce the title weight. If you have rich metadata (tags, categories), add columns with appropriate weights.

3. **Choose chunk sizes based on your embedding model.** We target 300-800 tokens for `bge-base-en-v1.5`. If you use a model with a larger context window (e.g., 8K tokens), you can use larger chunks -- but larger chunks make less specific vectors. The tradeoff is precision vs. context.

4. **Tune the semantic weight empirically.** Start at 0.5 (equal weighting), then search for 10 queries where you know the right answer. If semantic results are displacing correct lexical matches, reduce the weight. If relevant conceptual matches are missing, increase it. Our 0.55 reflects a text-heavy corpus where exact matches dominate.

5. **Set the semantic threshold by inspecting scores.** Embed a few known-relevant and known-irrelevant queries. Look at the cosine similarity distribution. The threshold should be above the noise floor (irrelevant matches) and below genuine matches. For `bge-base-en-v1.5` on English text, 0.70-0.80 is typical.

6. **The semantic-only penalty matters most for small corpora.** With 234 issues, Vectorize always finds "something." With 10,000 documents, the noise floor is lower because there are more genuinely relevant candidates. You may not need the penalty at all for larger corpora.

7. **Expose weights as config, not code.** We use Cloudflare Worker environment variables. Every tuning change is a config update, not a redeploy. This is essential for iterating on search quality without a deployment cycle.

## How we verify search quality

Search quality is tested at six levels, from unit tests to live API verification. Each level catches a different class of bug.

### Level 1: Ranking unit tests (test/semantic-threshold.test.ts)

Tests the ranking algorithm in isolation with synthetic FTS and Vectorize results. Verifies:
- Weak vector-only results (cosine < 0.75) are filtered out
- Co-matched results (FTS + vector) bypass the threshold
- The semantic-only penalty (-3.5) applies only when 3+ FTS results exist
- The boundary at exactly 0.75 is correctly enforced

These tests use mock data — no network, no D1, no Vectorize. They run in <100ms and catch ranking logic bugs immediately.

### Level 2: FTS safety tests (test/fts-safety.test.ts)

Verifies that user input containing FTS5 special characters doesn't crash the search. Apostrophes, colons, angle brackets, ampersands, slashes, parentheses, and asterisks are all sanitized before reaching the MATCH clause. Tests both the sanitizer function and the live API.

### Level 3: Pipeline consistency PBT (test/search-consistency.test.ts)

Property-based tests that assert invariants across the search pipeline:
- `sum(section_facets) == total_hits` for any set of results
- `sum(quarter_distribution) == total_hits` for any set of results
- Section facets match quarter section totals

These catch pipeline ordering bugs — e.g., computing aggregates before section detection runs, which silently undercounts sections.

### Level 4: Relevance evaluation harness (test/relevance.test.ts)

Hand-labeled queries with expected results:
- `"decision treadmill"` → issue #230 is the top result
- `unstuck` → issue #55 "How to get unstuck" is first
- `section:lens` → all results are from the lens section
- `before:2022` → all results published before 2022
- No result contains Substack boilerplate in its snippet or title

These catch ranking regressions and data quality issues.

### Level 5: Integration tests (test/search-integration.test.ts)

Calls the live API and verifies:
- All three query paths (normal, filter-only, issue-lookup) return the same 7 top-level fields and 9 result fields
- Aggregates are consistent across pages (page 1 and page 2 have identical distributions)
- Section filter returns only results from the specified section

### Level 6: Comprehensive search quality suite (test/search-quality.test.ts)

Comprehensive test suite covering ranking quality, section filters, date filters, aggregate consistency, result quality, pagination, and edge cases. This is the broadest suite — it exercises the search end-to-end against the deployed API with diverse queries and verifies the full contract.
