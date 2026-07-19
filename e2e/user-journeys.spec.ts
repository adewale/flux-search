import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test('shows quote of the day and search box', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#search-input')).toBeVisible();
    // Wait for both independent cold-start requests to settle.
    await expect(page.locator('#landing-quote')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `e2e/screenshots/landing-${test.info().project.name}.png` });
  });
});

test.describe('Search journey', () => {
  test('search for trust → see results → click through', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });

    // Type and search after cold-start completion so the user owns the input.
    await page.fill('#search-input', 'trust');
    await page.press('#search-input', 'Enter');

    // Wait for results
    await expect(page.locator('.result-card')).toHaveCount(20, { timeout: 10000 });
    await page.screenshot({ path: `e2e/screenshots/search-trust-${test.info().project.name}.png` });

    // Check density strip visible (desktop only)
    if (test.info().project.name === 'desktop') {
      await expect(page.locator('#density-strip')).toBeVisible();
    }

    // Check section facets
    await expect(page.locator('#section-facets')).toBeVisible();

    // Check first result has a title
    const firstTitle = page.locator('.result-card').first().locator('.result-title');
    await expect(firstTitle).not.toBeEmpty();

    // Click first result
    const firstLink = page.locator('.result-card a').first();
    const href = await firstLink.getAttribute('href');
    await firstLink.click();

    // Should navigate to issue page
    await expect(page).toHaveURL(/\/issues\/issue\/\d+/);
    await page.screenshot({ path: `e2e/screenshots/issue-page-${test.info().project.name}.png` });
  });
});

test.describe('Issue landing page', () => {
  test('shows sections with navigation', async ({ page }) => {
    await page.goto('/issues/issue/198#lead_essay');

    // Wait for issue page to load (JS fetches sections API)
    await page.waitForSelector('#issue-page:not([hidden])', { timeout: 15000 });
    await page.screenshot({ path: `e2e/screenshots/issue-198-${test.info().project.name}.png` });
  });
});

test.describe('Empty state', () => {
  test('shows suggestions for no results', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.fill('#search-input', 'qxzjvkwm');
    await page.press('#search-input', 'Enter');

    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#empty-state')).toContainText('No results found');
    await expect(page.locator('.result-card')).toHaveCount(0);
    await expect(page.locator('#loading')).toBeHidden();
    await page.screenshot({ path: `e2e/screenshots/empty-state-${test.info().project.name}.png` });
  });
});

test.describe('Autocomplete', () => {
  test('suggests words as you type', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');

    const autocompleteResponse = page.waitForResponse((response) =>
      response.url().includes('/autocomplete?q=tru') && response.ok(),
    );
    await page.fill('#search-input', 'tru');
    await autocompleteResponse;
    await expect(page.locator('.autocomplete-item').first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `e2e/screenshots/autocomplete-${test.info().project.name}.png` });
  });
});
