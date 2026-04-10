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
