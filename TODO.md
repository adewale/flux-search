# TODO

## Data quality

- [ ] **4 non-issue posts in D1** — `the-toynbee-convector-by-ray-bradbury`, `the-goal-a-business-graphic-novel`, `semantic-similarity-note-taking`, `forever-flowing-by-vasily-grossman` are standalone Substack posts indexed as issues without numbers. Either exclude from the classifier or give them a distinct content type so they don't pollute search results.
- [ ] **Stale semantic vectors** — the force re-bootstrap re-normalized text and re-chunked, but the embedding step may have partially failed under Worker CPU limits. Some chunks might have old vectors that don't match the cleaned text. Verify by comparing chunk text in D1 against vector metadata in Vectorize.

## UX

- [ ] **Density strip click-to-filter** — clicking a bar should filter results to that quarter using the existing `before:` and `after:` operators. Highest-impact improvement from the density strip research.
- [ ] **Screenshot regression tests** — Playwright is installed but screenshots are taken manually. Could add visual regression tests that run against the deployed site after each deploy.

## Operations

- [ ] **Re-bootstrap is manual** — requires running curl with the admin token in 5 batches (`?force=true&offset=0,50,100,150,200`). Could be automated with a single endpoint that pages through all issues internally, or via Cloudflare Workflows for durable execution beyond the Worker CPU limit.
