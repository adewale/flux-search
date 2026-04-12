# Lessons Learned

## The arc of the project

We built a search engine for The FLUX Review newsletter archive in 8 commits over several days. The project went through distinct phases, and each one taught something different.

### Phase 1: Build everything from the spec (commit 1)

We took a detailed product spec and translated it into a full Cloudflare Workers application in one session: D1 schema, FTS5 indexing, Vectorize semantic search, hybrid ranking, crawl pipeline, admin endpoints, frontend — 47 files, 8,671 lines.

**What went wrong:** We built what the spec described without questioning whether the spec was right. The spec assumed a sitemap-index structure (year-level sub-sitemaps); reality was a flat sitemap. The spec assumed pre-Substack legacy sources; there were none. The spec prescribed R2, Browser Rendering, source_platform tracking, issue_aliases — none of which turned out to be needed. We built all of it, then spent the next several sessions removing it.

**Lesson: Build against reality, not against the spec.** The first thing we should have done was fetch the actual sitemap and look at the actual HTML. Ten minutes of real data inspection would have prevented hours of building and then removing features.

### Phase 2: Stripping dead weight (commits 1-2)

We removed R2, Browser Rendering, source_platform, issue_aliases, cover_image_url, slug, search_text, the in-memory rate limiter, phantom query operators (title:, author:, contributor:, source:), and dead env vars. Each removal required touching 5-15 files. The code got smaller and more honest.

**What went wrong:** We added features to satisfy spec checkboxes rather than user needs. The rate limiter was security theater (doesn't work across Workers isolates). The source_platform field distinguished a single source from itself. The title/author/contributor operators were parsed but never applied — users would have typed them, believed they worked, and gotten wrong results silently.

**Lesson: Phantom features are worse than missing features.** A feature that appears to work but doesn't (phantom filters, non-functional rate limiting) actively harms the user. It's better to have no filter than a filter that silently ignores input.

### Phase 3: The testing gap (commit 2)

We had written zero tests before the first audit flagged it as blocking. We then added unit tests for the pure-logic modules (query parser, chunker, normalizer, hybrid ranker) and property-based tests with fast-check. The property tests immediately found a matcher bug (`toStartWith` doesn't exist in vitest).

**What went wrong:** We wrote all the production code first and added tests as an afterthought. The audit had to tell us to test auth middleware — the only security boundary in the system was untested.

**Lesson: Write the test before the code, or at least alongside it.** Not for TDD purity, but because tests force you to think about the interface before the implementation. Our property-based tests ("the query parser never crashes on arbitrary input") encode invariants that unit tests miss.

### Phase 4: Bootstrapping against reality (commits 2-3)

The bootstrap revealed three bugs the spec couldn't predict:
1. The sitemap was flat, not a sitemap index — the parser found 0 URLs
2. Substack uses `data-rh="true"` before `property` attributes — metadata extraction failed
3. Issue titles are "🌀🗞 The FLUX Review, Ep. 198" not "#198" — issue number extraction failed
4. `<body>` was matched by the `<b>` regex in the HTML-to-markdown converter — bold text was corrupted

Each bug was only discoverable by running the code against real data.

**Lesson: The gap between the spec and reality is where the bugs live.** Specs describe ideal structures; real data has emoji in titles, non-standard HTML attributes, and URLs that don't match the assumed pattern. The sooner you hit real data, the sooner you find real bugs.

### Phase 5: The experience reckoning (commits 3-8)

After deploying with 233 issues, we looked at the actual search results and asked "is this a good experience?" The answer was no:

- Every title said "🌀🗞 The FLUX Review, Ep. N" — you couldn't tell results apart
- Snippets showed Substack boilerplate, not the content that matched
- Clicking a result showed a JSON blob (the issue detail page was broken)
- Semantic search had never contributed a single result (silent failure)
- The density strip was informative but results were undifferentiated

This led to the biggest changes: extracting the lead essay structure from each issue, cleaning titles at ingestion time, adding FTS highlighting, and replacing the issue detail page with direct Substack links.

**Lesson: A search engine is only as good as its results display.** We spent days on ranking algorithms, fusion weights, and architecture — then shipped results that all looked identical. The ranking was correct (phrase matches beat semantic-only) but invisible because every result card showed the same template title.

## What went wrong with the spec

1. **The spec over-specified infrastructure and under-specified user experience.** Sections 6-12 (crawling, normalization, data model, FTS, Vectorize, hybrid ranking) totaled ~400 lines of detailed design. Section 15 (user experience) was 20 lines: "result card should show: issue title, issue number, publish date, source badge, short snippet." The infrastructure worked. The experience didn't. The spec should have started with "what does a search result look like?" and worked backward.

2. **The spec assumed a problem that didn't exist.** Sections 6-7 describe a multi-platform discovery strategy (Substack + legacy archives, sitemap index + link crawling, Browser Rendering for JS-heavy pages). Reality: one flat Substack sitemap, all issues server-rendered. The elaborate discovery architecture was solving a problem that didn't exist.

3. **The spec prescribed solutions instead of constraints.** "Use R2 for raw artifacts" is a solution. "Ingestion must be auditable and replayable" is a constraint. The constraint is valuable regardless of implementation; the solution locks you into a specific service. We removed R2 because the constraint (idempotent re-crawl from stable URLs) was already satisfied without it.

4. **The spec didn't define what a FLUX Review issue IS.** It listed extraction fields (title, subtitle, summary, authors) but never described the actual structure of an issue: opening quote, lead essay with its own title, signposts section, lens of the week, etc. This domain knowledge was essential for making search results useful, but it wasn't in the spec — we had to discover it by reading the actual issues.

## What would have made things better

1. **Start with one real issue, not a spec.** Fetch issue #198. Read it. Identify the structure. Now you know what you're indexing and how to display it. Then fetch the sitemap. Parse it. Now you know the discovery mechanism. The spec could have been 50 lines of constraints informed by 10 minutes of data inspection.

2. **Prototype the results page first, with fake data.** If we'd mocked up 5 search results with real FLUX Review content and asked "does this help you find what you're looking for?", we'd have discovered the title problem, the snippet problem, and the lead essay insight on day one.

3. **Deploy after the first feature, not after all features.** We deployed 47 files in one commit. By the time we tested against real data, every layer was already built. A better sequence: deploy the sitemap parser first, verify it finds all 233 URLs. Then deploy the crawler, verify it extracts clean content for one issue. Then deploy FTS, verify one search query works. Each deployment is a reality check.

4. **Test the product, not just the code.** Our 120 unit tests verify that the query parser handles edge cases and the ranker orders results correctly. None of them verify that the user can find issue #198 when they search for "just enough structure." A small set of end-to-end relevance tests (query → expected top result) would have caught the dirty-titles problem before it shipped.

## Which tools would have helped

1. **A real Substack API.** The entire crawl pipeline (fetch HTML → regex-parse → convert to markdown → strip boilerplate) exists because Substack doesn't offer a structured content API for newsletters. If we could call `GET /api/posts?newsletter=flux-review` and get JSON with clean titles, body text, and publish dates, half the codebase wouldn't exist.

2. **Cloudflare Workflows.** The bootstrap hit the 30-second Worker CPU limit repeatedly, requiring us to call it 3-8 times. Cloudflare Workflows (durable execution) would let a single invocation process all 233 issues with automatic retries per step. We built a workaround (iterative batch loop), but the workaround is still limited by the same timeout.

3. **A visual regression tool.** Most of the UI problems (hidden spinner showing, results all looking identical, JSON blob on click) would have been caught by a screenshot comparison tool. We caught them by manually opening the URL and looking. A tool like Playwright or Chromatic running against the deployed URL after each deploy would automate this.

4. **A relevance evaluation harness.** The spec (section 21) calls for a hand-labeled evaluation set. We never built one. A simple JSON file of `{ query, expected_top_3_issue_numbers }` tested against the live API after each deploy would have caught the title pollution problem (every issue matching "FLUX" with high title weight) and the zero-semantic-results problem.

5. **Wrangler's `--remote` flag for `dev` mode.** The local dev server can't use Vectorize or AI bindings, which meant we couldn't test semantic search locally. Running `wrangler dev --remote` with a test database would have let us verify the full hybrid search path before deploying.

## What we learned about testing (the hard way)

### PBT finds bugs that example tests miss — every time

We ran three rounds of property-based testing with fast-check. Every round found real bugs:

| Round | Counterexample | Bug |
|---|---|---|
| 1 | `"\"     "` | Opening quote not stripping inner `"` characters |
| 1 | `">     "` | Opening quote not stripping `>` in text |
| 2 | `[2000, 0]` → `before:2000-00` | Invalid month (00) accepted by parseDate |
| 2 | `[1, "a"]` → `/p/1-a` | Issue number regex fails on number-slug URLs |
| 3 | `[2000, 9, 31]` → `before:2000-09-31` | Sept 31 accepted (Date silently rolls to Oct 1) |
| 3 | `["", ""]` → `[](url)` | Empty link text not stripped from plain text |
| 3 | `["]", ""]` → `[]](url)` | Nested bracket in link text breaks regex |

These are not contrived edge cases. Empty link text `[]()` appears in real Substack content. URLs like `/p/198-title-slug` are actual Substack URL patterns. Sept 31 is a date a user could plausibly type.

The pattern: every regex-based string transformation has edge cases that example tests don't cover. PBT generates the counterexamples automatically. The cost is ~50 lines of test code per function. The value is catching bugs before users do.

### Audit-test-fix cycles compound

We ran the test audit three times. Each time it found new issues:

- **Round 1**: Found that 16/20 source files had no tests. Added tests for the core logic modules.
- **Round 2**: Found wrong tests (makeFtsResult missing `highlightSnippet`, weak word count assertion), untested pure functions (`extractSubtitle`, `extractHeadings`, `buildFtsQuery`), and PBT opportunities. PBT found 2 bugs.
- **Round 3**: Found that the round-2 fixes introduced no tests for 5 more functions, that `phrase_heading` boost was completely untested, and that `parseDate` still had a roundtrip bug. PBT found 3 more bugs.

Each round raised the bar. The first round went from 0 to "core logic tested." The second went from "tested" to "tested correctly." The third went from "tested correctly" to "tested with adversarial inputs." We went from 0 to 173 tests, and more importantly, from 0 real bugs found to 7.

### Don't skip testing under shipping pressure

Between commits 4 and 8 (lead essay extraction, semantic search fix, density strip changes), we shipped 5 features with zero new tests. The lessons-learned doc — written in that same session — says "write the test before the code." We violated it within the hour. The round-2 audit caught this: `cleanContent` had a link-stripping bug that would have been caught by the 30-second PBT we wrote later.

### "Wrong tests" are worse than missing tests

Three tests gave false confidence:
- `makeFtsResult` omitted `highlightSnippet` → FTS highlight path was never exercised, but the test claimed to test snippet generation
- "computes word count" asserted `> 0` → would pass if counting characters instead of words
- "strips subscription prompts" checked only `full_text_plain` → would pass if the markdown regex broke but the text conversion coincidentally removed the phrases

A missing test is honest — you know you're not covered. A wrong test is dangerous — you believe you're covered when you're not.

## What we learned about design

### Design is systematic constraint, not decoration

We started with default styling, then applied design skills (delight, typeset, bolder, colorize, animate, polish, optimize) one at a time. The result was incoherent — 12 font sizes, 7 weights, colors chosen by gut feel. The breakthrough was switching from additive ("let's make this look nicer") to subtractive ("what's the minimum set of constraints that produces coherence?").

The typography rationalisation cut from 12 sizes to 5 using a 1.5× modular scale (11px → 16px → 24px → 36px → 64px), from 7 weights to 4 (300/400/600/700), and enforced zero raw CSS values — every property references a token. The section colors went from hand-picked hex values to `oklch(65% 0.08 H)` — same lightness and chroma, varying only hue. Both changes made the design more coherent by reducing the number of decisions.

**Lesson: Good design is a small set of rules applied consistently, not a large set of individual choices.** A modular scale, a constrained weight palette, and a single color formula produce better results than choosing each value independently. The rules do the work; the designer chooses the rules.

### Three fonts with clear roles beat one font trying to do everything

We settled on Lora (wordmark only — bold serif identity), Literata (all reading text — body, quotes, snippets), and DM Sans (everything else — UI, labels, navigation). Each font has exactly one job. This clarity made typography decisions mechanical: "Is this reading text? Literata. Is it UI? DM Sans."

### Reuse existing patterns instead of inventing new ones

The latest issue was first shown as a custom card component (label, bordered box, meta text, title). It looked fine but was a one-off pattern that didn't match anything else on the page. Replacing it with a pre-populated search — filling the search box with `issue:N` and showing the standard search result — was better in every way: zero new CSS, consistent with what users see when they search, and the search result card was already the best representation of an issue.

**Lesson: Before building a new component, check if an existing pattern already solves the problem.** The search result card is tested, styled, confidence-tiered, section-colored, and links to the right place. A custom card would have needed all of that from scratch.

## What we learned about distributed systems

### Silent failures are the worst failures

Semantic search never contributed a single result for the first several deploys. The cause: `returnMetadata: 'indexed'` in the Vectorize query. Without metadata indexes configured, this returned empty metadata for every vector — so the ranker had no issue IDs to match against. The fix was changing one word: `'indexed'` → `'all'`.

No errors were thrown. No logs indicated a problem. The search "worked" — it returned FTS results. The system degraded silently to lexical-only search, and the only way to notice was to look at the `matched_by` field in debug mode and wonder why it never said `vector`.

**Lesson: Distributed systems fail silently at integration boundaries.** Each component (Workers, Vectorize, D1) worked correctly in isolation. The failure was in how they connected. The same pattern appeared with the semantic score threshold — without `SEMANTIC_MIN_SCORE = 0.75`, weak vector matches polluted results with confident-looking noise. Both problems were invisible without looking at actual search results and asking "is this right?"

### Separate fetch from process from validate

The corpus pipeline went through three iterations. First: fetch and process in one step (the crawler). Problem: every normalizer fix required re-crawling 233 issues from Substack. Second: fetch once, process locally. `fetch-corpus.sh` downloads raw HTML to `data/raw/`; `process-corpus.sh` runs normalisation locally with no network. Third: add a validation layer. `validate-corpus.ts` runs 1,401 checks across 234 records.

The separation made normalizer iteration 100× faster (local file processing vs. network fetches) and made bugs reproducible (same input, same output). The validation layer caught date corruption, emoji leakage, and missing fields before upload.

**Lesson: Separate the irreversible (network fetch) from the reversible (local processing) from the verifiable (validation).** When you can re-run the middle step instantly with the same inputs, you can iterate on data quality without touching the network.

## What we learned about domain modeling

### Structure emerges from the data, not from the spec

The spec described issues as flat documents with title, body, and metadata. Reading the actual issues revealed a rich internal structure: opening quote, lead essay with its own title, signposts section, lens of the week, book recommendations, postcards, and more. Each section type has a distinctive emoji-prefixed heading pattern.

This discovery reshaped the entire architecture. We built `parseSections` to identify section types by heading patterns. Chunks became section-typed. Search results show which section matched. Facets let users filter by section type. Issue landing pages have tabbed section navigation. None of this was in the spec, and all of it makes the search experience meaningfully better.

**Lesson: The most valuable domain knowledge isn't in the spec — it's in the data.** Read the actual content before designing the data model. The structure of a FLUX Review issue (quote → lead essay → signposts → lens → book → postcard) is the single most important design insight in the project, and it came from reading issues, not from reading the spec.
