# Visual regression API fixtures

These public API responses freeze the data used by `e2e/visual-regression.spec.ts` while Playwright still loads the real HTML, JavaScript, and CSS from `PLAYWRIGHT_BASE_URL`.

Captured from Cloudflare Worker version `e12a5404-dcc5-457b-9120-c87ef323c380` on 2026-07-19:

- `search-crypto.json` — `/search?q=crypto&limit=20&page=1`
- `search-unstuck.json` — `/search?q=unstuck&limit=20&page=1`
- `search-trust.json` — `/search?q=trust&limit=20&page=1`
- `search-empty.json` — `/search?q=qxzjvkwm&limit=20&page=1`
- `issue-198.json` — `/issues/issue/198/sections`

Refresh fixtures only when the intended visual test data changes. After refreshing, review the rendered desktop and mobile pages before running:

```bash
PLAYWRIGHT_BASE_URL=<approved-preview> \
  npx playwright test e2e/visual-regression.spec.ts --update-snapshots
```
