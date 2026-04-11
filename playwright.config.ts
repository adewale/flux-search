import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'https://flux-search.adewale-883.workers.dev',
    screenshot: 'on',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
  ],
  outputDir: 'e2e/screenshots',
});
