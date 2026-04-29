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

## What we learned about pipeline ordering

### Aggregates and transformations must share a single pipeline

The search handler computes three things from ranked results: section facets, quarterly distribution, and per-result section labels. Section detection is expensive (parses full markdown per result), so we initially placed it inside the pagination map — only the 20 results on the current page got sections detected. But the aggregates (facets, density strip) were computed from ALL ranked results, where most had null sections. The result: facets showed 6 instead of 95, and the density strip was mostly gray.

The fix was simple — move detection before aggregation. But the bug survived for weeks because each function was tested in isolation. `computeSectionFacets` worked correctly when given results with sections set. `detectSnippetSection` correctly found sections. No test verified that detection ran before facets.

Then we discovered the section filter (`section:lens`) also ran before detection, so FTS-only results couldn't be filtered by section. And the filter-only path (`before:2024`) had no section detection at all. Three features, three independent bugs, all from the same root cause: pipeline ordering.

**Lesson: When multiple features consume the same data, document the pipeline ordering and test the pipeline as a whole.** Unit tests of individual functions don't catch ordering bugs. Integration tests that assert invariants across the full pipeline do. Our PBT (`sum(facets) == total_hits`) would have caught this on day one.

### Every query path must return the same response shape

The search handler has three paths: normal search, filter-only, and issue number lookup. They evolved independently, and each had a different response shape — the issue lookup was missing `year_distribution`, `quarter_distribution`, `section_facets`, and `snippet_section`. The filter-only path had empty aggregates. The normal path was the only one that was correct.

**Lesson: Define the response contract first, then implement each path to satisfy it.** We now document the 7 required top-level fields and 9 required result fields in the architecture doc. An integration test verifies all three paths return the same shape.

## What we learned about content cleaning

### Cleaning is a pipeline, and pipelines have ordering dependencies

The normalizer has ~30 regex rules that strip Substack boilerplate. The order matters: profile link stripping (`[Name](substack.com/profile/...)`) must run before byline cleanup (`(?:,\s*){2,}and N others`) because the byline only has orphaned commas after the links are removed. Subscribe stripping must run last because other rules expose standalone `Subscribe` lines. The image caption regex runs twice — once early and once late — because the first pass catches standalone captions while the second catches captions exposed by earlier stripping.

We discovered this through corpus testing. Unit tests with synthetic inputs passed because the test data didn't have the complex interleaving of the real HTML. Only running the normalizer against all 234 raw HTML files revealed the ordering dependencies.

**Lesson: Test your data pipeline against real data, not synthetic inputs.** Adding `data/raw/` to the git repo and running corpus tests in CI was the single most impactful quality decision. Every normalizer regression is now caught before merge.

### Cleaning rules accumulate; audit periodically

We added cleaning rules in 5 separate sessions. By the end, the normalizer had duplicate regexes, late-pass duplicates that were actually necessary, and a Subscribe regex in three different locations. A consistency audit found the duplication, but distinguishing "redundant duplicate" from "necessary late-pass" required understanding the full pipeline.

**Lesson: After adding cleaning rules iteratively, audit the full set for redundancy and ordering.** Comment each rule with why it exists and why it's at that position in the pipeline.

## What we learned about visualization

### Visual weight should match information weight

The density strip started as a 24px sparkline — a glanceable summary. Over several iterations, it grew to an 80px panel with stacked section-colored bars, milestone annotations, tooltip hit areas, year labels, and a bordered card. Each feature was justified individually, but the cumulative effect was a chart that demanded more attention than the search results it was supposed to support.

For a query returning 3 results, the density strip was larger than all three result cards combined. For the landing page showing 1 result, the chart was pure overhead. We had to explicitly hide it on the landing page via the state machine and ask ourselves "is this a good experience?" to recognize the problem.

**Lesson: Periodically step back and ask whether a component's visual weight matches its information weight.** A sparkline that grows into a dashboard panel is a sign that features were added without considering their cumulative visual cost. Tufte's principle applies: the data-ink ratio should increase, not decrease, as you iterate.

### "Is this a good experience?" is the most valuable question

We asked this question repeatedly throughout the project. Every time, the answer was no, and the follow-up work was the most impactful of the project: extracting lead essay titles, fixing semantic search, cleaning snippets, removing the density strip from the landing page. The question works because it forces you to look at the product through the user's eyes rather than the developer's.

## What we learned about testing

### Integration tests catch bugs that unit tests cannot

The consistency bug (facets showing 6 instead of 95) passed all unit tests. Each function worked correctly in isolation. The bug was in how the functions were composed — an ordering dependency that no unit test covered. The integration test that caught it was trivial: call the search endpoint and assert `sum(facets) == total_hits`.

The relevance evaluation harness (13 hand-labeled queries) caught a real bug on its first run: `section:lens` as a filter-only query returned all 234 issues unfiltered. No unit test had ever exercised this code path against the live API.

**Lesson: Integration tests and property-based tests are not optional extras — they catch the most important class of bugs.** Write `sum(aggregates) == total_hits` before you write the aggregation code.

### The corpus IS the test suite

Adding 234 raw HTML files to the repo transformed our testing. Before: synthetic inputs in unit tests, manual spot-checks against the live API. After: every normalizer change is validated against every real issue. The corpus-crud test checks 24 boilerplate patterns × 234 issues = 5,616 assertions. The corpus-survival test verifies word counts, section structure, and title quality across the full archive.

The 48MB cost is trivial compared to the bugs it prevents. Three normalizer fixes were found only by running against the corpus — patterns that appeared in 200+ issues but never in our synthetic test data.

## What we learned about type boundaries

### Internal labels leak to users unless the boundary is explicit

The chunker labels its first chunk `title_summary` — an internal label for the vector index. This label leaked through the search pipeline into the API response, the result card (no color stripe), and the issue page URL (`#title_summary` — a non-existent tab). The leak was invisible because `title_summary` is a valid string — no error, no crash, just wrong behavior.

The fix was creating distinct types: `ChunkLabel` (internal, includes `title_summary`) and `DisplaySection` (user-facing, does not). A `toDisplaySection()` function is the single conversion point. Any new chunk label must be explicitly mapped here or it becomes `other`. The compiler can now catch mismatches.

**Lesson: When data crosses a boundary between internal and user-facing systems, make the boundary a function with distinct types on each side.** String typing (`section: string`) lets anything through. Branded types (`section: DisplaySection`) make leaks visible at compile time.

## What we learned about visual alignment

### Browser-verified tests catch what coordinate math misses

We aligned the Y-axis label, result count, and result cards to a shared content grid by adjusting CSS padding and SVG coordinates. The math said they should align. The Playwright bounding-box tests said they didn't — the CSS `aspect-ratio: 6/1` was silently distorting the SVG coordinate mapping, shifting the label 20px from its expected position.

The fix was removing the CSS aspect-ratio override and letting the SVG scale naturally from its viewBox. But we only discovered the problem because the Playwright test checked *rendered* bounding boxes in a real browser, not SVG coordinate math.

**Lesson: Visual alignment bugs live in the gap between coordinate systems.** SVG viewBox units, CSS pixels, and rendered bounding boxes are three different coordinate systems that don't always agree. Test the rendered output, not the input coordinates. `element.getBoundingClientRect()` is the source of truth.

### Two alignment edges are better than three

The page originally had three left edges: 0px (header elements), ~5px (density panel content), and 8px (result card text). Each was close to the others but not identical — they looked like mistakes rather than intentional choices.

Consolidating to two edges — 0px for interactive chrome (search box, refine chips, panel borders) and ~8px for content (result count, chart, facets, results) — made the page feel ordered. Moving the Y-axis label above the chart freed the left margin from label-width duty, allowing the chart's left edge to align exactly with the content grid.

**Lesson: If you have N alignment edges where N > 2, reduce to 2.** One edge for structure, one for content. Every element on the page should belong to exactly one. Three "almost aligned" edges are worse than two deliberately different ones.

## What we learned about chart design

### Every axis must match its visual encoding

The density strip Y-axis initially showed `maxCount` (the actual highest bar value) but the bars were scaled to `scaleMax` (which includes a `MIN_SCALE` floor). When `MIN_SCALE > maxCount`, the axis said "1" but the tallest bar was only 20% of the axis height. The label lied about what the visual height meant.

**Lesson: The axis label must show the value that the visual encoding is proportional to.** If bars scale to `effectiveMax`, the axis must say `effectiveMax`. If you add a minimum scale floor, the axis must reflect it.

### Fixed-width bars derived from the maximum possible density

Bar width was initially calculated per-query, making "unstuck" (3 bars) look completely different from "crypto" (15 bars). Fixing the width to `chartWidth / 21 quarters * 0.8` made every query's chart visually consistent. Sparse queries show narrow bars with empty space (correct), dense queries fill the chart (correct).

**Lesson: Derive visual constants from the data model's constraints, not from individual queries.** The archive has at most 21 quarters. That's a known maximum. Using it as the basis for bar width makes every chart comparable.

### FTS5 special characters crash the search

Apostrophes (`it's`), colons (`foo:bar`), angle brackets, ampersands, and slashes all cause FTS5 MATCH syntax errors. Users type these naturally. The fix: strip everything except word characters, spaces, and hyphens before passing to FTS5. A whitelist (`[^\w\s-]` → space) is safer than a blacklist of known special characters.

**Lesson: Sanitize at the boundary between user input and query syntax.** FTS5, SQL, and regex all have syntax characters that overlap with natural language. Don't list the dangerous characters — keep only the safe ones.

## What we learned about topic surfaces

### Topic extraction is only useful when it becomes navigation

Adding YAKE topic extraction created useful data, but the feature only became visible once topics appeared across the product: result-card subtitles, issue-page chips, the recurring themes strip, `/topics`, `topic:` filters, and related issues. The database rows were not the feature; the navigational spine was the feature.

**Lesson: Treat extracted metadata as product affordances, not just analytics.** If a topic appears in an issue, users should be able to click it, filter by it, and use it to discover neighboring issues. Otherwise it is just hidden bookkeeping.

### Related content needs both a data contract and a layout contract

Related issues by topic overlap were easy to compute, but the first implementation blurred mobile layout semantics by placing related issues inside the same details block as topics. The spec called for separate mobile affordances: topics above the article and related issues below the article body. That distinction matters because topics help orient the reader before reading, while related issues are a next-step after reading.

**Lesson: API shape is not enough; specify where the affordance belongs in the reading flow.** `related_issues` in JSON is necessary, but placement determines whether it interrupts or supports the user.

### Specs drift unless they are updated with implementation reality

The Yaket spec still referenced `@ade_oshineye/yaket@0.4.0` after the project had moved to `0.5.3`. That is small, but stale version references erode trust in the whole spec. The same happened with the Bobbin comparison doc: once the remaining work became Flux-specific queue work, keeping the Bobbin vocabulary around made future work harder to reason about.

**Lesson: Update specs when implementation decisions change, especially names and versions.** Specs are working documents, not fossils. If a name is no longer the language of the system, move or archive it.

## What we learned about queue migrations

### Add a durable seam before moving the expensive work

The first queue implementation intentionally handled `embed-corpus-topics` as a measured, acked seam before it performed the full embedding implementation. That looked incomplete, but it let us deploy the operational shape first: queue binding, DLQ, message fan-out, retries, logs, and admin visibility. The next iteration added durable job rows and idempotency without changing public search behavior.

**Lesson: Queue migrations are safest when split into two steps: establish the durable transport, then move the expensive work.** If the transport fails, users should not see a product regression. Once message delivery, retries, and inspection work, moving computation behind the seam is much less risky.

### At-least-once delivery makes idempotency a schema concern

Cloudflare Queues deliver at least once. That means idempotency cannot live only in handler code or comments. We added deterministic semantic keys, `pipeline_jobs`, active-job uniqueness, and claim/succeed/fail/defer helpers so duplicate messages have a durable coordination point.

**Lesson: If duplicate delivery is possible, make deduplication persistent.** A pure function that computes an idempotency key is useful; a table that enforces active uniqueness is what prevents duplicate work under retries and redeploys.

### Message contracts need migration compatibility

The queue spec wanted `kind`, `schemaVersion`, `jobId`, `correlationId`, and `queuedAt`; the first implementation already had producers using `type` and `run_id`. Rather than flipping the contract abruptly, the consumer now supports both during migration.

**Lesson: Queue messages are deployed data, not just TypeScript types.** Old messages can remain in flight while new code deploys. Consumers should be liberal during migrations and producers should converge on the new shape.

### Queue observability should be queryable, not just logged

Wide JSON logs are useful for grep and dashboards, but they are not enough for operations. Admins need to answer concrete questions: which jobs belong to this run, how many attempts did a job take, which jobs failed, and what should be replayed? Adding `/admin/pipeline-runs/:id/jobs` and durable job status made those questions answerable without spelunking logs.

**Lesson: If an operator will ask it during an incident, store it in D1.** Logs explain what happened; durable job state explains what still needs action.

### Await queue work unless detachment is deliberate

The initial queue handler wrapped processing in `ctx.waitUntil`, which made the queue handler return before the actual message work completed. That is appropriate for non-critical side effects, but queue message processing is the critical work. The handler now awaits processing directly.

**Lesson: In a queue consumer, awaiting is the default.** Detach only when the work is explicitly non-critical and the ack/retry semantics are still correct.

## What we learned about D1 after the topic-detail outage

The `systems thinking` topic appeared in 106 issues. The first fix for its broken detail page was to chunk a large `WHERE id IN (?, ?, ...)` query into smaller queries. That made the page work, but it was still the wrong mental model: it treated D1 like a remote key-value store and moved relational work into JavaScript.

The better fix was a single indexed join:

```sql
SELECT i.*
FROM issue_topics it
CROSS JOIN issues i ON i.id = it.issue_id
WHERE it.keyword = ? AND i.status = 'active'
ORDER BY i.published_at DESC
```

This uses one bind parameter, lets SQLite/D1 choose indexed access, and avoids statement-size/bind-count cliffs. We added query-plan tests and a remote `db:explain-hot-paths` script so this does not regress.

### D1 rules for this project

1. Prefer set-oriented SQL over JavaScript loops. If the data is already relational, join it in D1 instead of fetching IDs into JS and sending them back as a dynamic `IN` list.
2. Avoid large dynamic bind lists. For small UI page lists, bind a single JSON array and join against `json_each(?)`; for relational lookups, use real joins.
3. Add indexes only for measured hot paths, then verify them with `EXPLAIN QUERY PLAN` and `PRAGMA optimize`.
4. Retry write queries on transient D1 errors with exponential backoff; D1 retries some reads automatically, but application writes need their own retry boundary.
5. Long-running rebuilds should use queues for execution and D1 for durable state, but aggregation inside each phase should still be set-oriented SQL where possible.

The Bobbin ingestion lesson applies here too: batching is necessary, but batching many tiny queries is not as good as asking the database the right set-based question once.
