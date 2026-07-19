import type { Page } from '@playwright/test';
import cryptoSearch from './fixtures/visual/search-crypto.json';
import emptySearch from './fixtures/visual/search-empty.json';
import trustSearch from './fixtures/visual/search-trust.json';
import unstuckSearch from './fixtures/visual/search-unstuck.json';
import issue198 from './fixtures/visual/issue-198.json';

const searchFixtures: Record<string, unknown> = {
  crypto: cryptoSearch,
  qxzjvkwm: emptySearch,
  trust: trustSearch,
  unstuck: unstuckSearch,
};

/**
 * Freeze API data for screenshot tests while still loading the real page,
 * JavaScript, and CSS from the selected deployment or preview URL.
 */
export async function installVisualApiFixtures(page: Page) {
  await page.route('**/search?**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const fixture = searchFixtures[query];
    if (!fixture) return route.continue();
    await route.fulfill({ json: fixture });
  });

  await page.route('**/issues/issue/198/sections', async (route) => {
    await route.fulfill({ json: issue198 });
  });
}
