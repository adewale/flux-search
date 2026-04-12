# TODO

## Data quality

- [ ] **4 non-issue posts in D1** — `the-toynbee-convector-by-ray-bradbury`, `the-goal-a-business-graphic-novel`, `semantic-similarity-note-taking`, `forever-flowing-by-vasily-grossman` are standalone Substack posts indexed as issues without numbers. Either exclude from the classifier or give them a distinct content type so they don't pollute search results.
- [ ] **Verify semantic vector freshness** — reindex runs were triggered but may not have completed for all issues under Worker CPU limits. Verify by spot-checking that vector metadata matches current chunk text.

## UX

- [ ] **Density strip click-to-filter** — clicking a bar should filter results to that quarter using the existing `before:` and `after:` operators. Highest-impact improvement from the density strip research.

## Operations

- [ ] **Re-bootstrap is manual** — requires running curl with the admin token in 5 batches (`?force=true&offset=0,50,100,150,200`). Could be automated with a single endpoint that pages through all issues internally, or via Cloudflare Workflows for durable execution beyond the Worker CPU limit.
