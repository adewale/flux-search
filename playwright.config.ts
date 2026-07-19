import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    // Defaults to the deployed Worker; point PLAYWRIGHT_BASE_URL at a local
    // `npm run dev` server (http://localhost:8787) to e2e-test unreleased
    // changes instead of production.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://flux-search.adewale-883.workers.dev',
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
});
