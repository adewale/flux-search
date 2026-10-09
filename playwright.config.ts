import { defineConfig } from '@playwright/test';

// PLAYWRIGHT_WEB_SERVER=wrangler serves this checkout with `wrangler dev`
// (wrangler.e2e.jsonc: local D1, no remote bindings) and tests it. Use this
// opt-in mode for specs that freeze API data with route fixtures
// (`npm run test:e2e:local`). Without it, specs default to the deployed
// Worker, or to PLAYWRIGHT_BASE_URL (e.g. http://localhost:8787 for a
// `npm run dev` server).
const localServer = process.env.PLAYWRIGHT_WEB_SERVER === 'wrangler';
const LOCAL_URL = 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL
      || (localServer ? LOCAL_URL : 'https://flux-search.adewale-883.workers.dev'),
    screenshot: 'on',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  outputDir: 'e2e/screenshots',
  ...(localServer ? {
    webServer: {
      command: 'npx wrangler d1 migrations apply flux-search-e2e-db --local -c wrangler.e2e.jsonc'
        + ' && npx wrangler dev -c wrangler.e2e.jsonc --ip 127.0.0.1 --port 8787',
      url: `${LOCAL_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  } : {}),
});
