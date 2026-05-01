# TODO

## Data quality

- [ ] **4 non-issue posts in D1** — `the-toynbee-convector-by-ray-bradbury`, `the-goal-a-business-graphic-novel`, `semantic-similarity-note-taking`, `forever-flowing-by-vasily-grossman` are standalone Substack posts indexed as issues without numbers. Either exclude from the classifier or give them a distinct content type so they don't pollute search results.

## UX

- [ ] **Density strip click-to-filter** — clicking a bar should filter results to that quarter using the existing `before:` and `after:` operators. Highest-impact improvement from the density strip research.

## Operations

- [ ] **Re-bootstrap is manual** — requires running curl with the admin token in 5 batches (`?force=true&offset=0,50,100,150,200`). Could be automated with a single endpoint that pages through all issues internally, or via Cloudflare Workflows for durable execution beyond the Worker CPU limit.
- [ ] **Topic type tail curation** — high-impact topics are typed, but many low-frequency corpus topics remain `unknown`. Add registry entries only when they improve UI, aliasing, or audits.
- [ ] **Rotate exposed admin token** — rotate `ADMIN_TOKEN` after any chat/log exposure.
