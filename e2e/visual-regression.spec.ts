/**
 * Visual regression tests — compare screenshots against stored baselines.
 *
 * First run creates the baselines in e2e/visual-regression.spec.ts-snapshots/.
 * Subsequent runs compare against them. Differences fail the test.
 *
 * To update baselines after intentional changes:
 *   npx playwright test e2e/visual-regression.spec.ts --update-snapshots
 */
import { test, expect } from '@playwright/test';

test.describe('visual regression', () => {
  test('landing page structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    // Verify structural elements are present
    await expect(page.locator('#search-input')).toBeVisible();
    await expect(page.locator('.search-btn')).toBeVisible();
    await expect(page.locator('.footer')).toBeVisible();
    // The landing pre-fills search, so a result card should appear
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 5000 });
  });

  test('search results: crypto', async ({ page }) => {
    await page.goto('/?q=crypto');
    await page.waitForSelector('.result-card', { timeout: 10000 });
    await expect(page).toHaveScreenshot('search-crypto.png', {
      maxDiffPixelRatio: 0.02,
      // Mask dynamic content
      mask: [
        page.locator('.result-snippet'),
        page.locator('.result-date'),
        page.locator('.density-result-count'),
      ],
    });
  });

  test('search results: unstuck (sparse)', async ({ page }) => {
    await page.goto('/?q=unstuck');
    await page.waitForSelector('.result-card', { timeout: 10000 });
    await expect(page).toHaveScreenshot('search-unstuck.png', {
      maxDiffPixelRatio: 0.02,
      mask: [
        page.locator('.result-snippet'),
        page.locator('.result-date'),
      ],
    });
  });

  test('issue page: #198', async ({ page }) => {
    await page.goto('/issues/issue/198#lead_essay');
    await page.waitForSelector('#issue-page:not([hidden])', { timeout: 15000 });
    await expect(page).toHaveScreenshot('issue-198.png', {
      maxDiffPixelRatio: 0.02,
      mask: [
        page.locator('.section-body'),
      ],
    });
  });

  test('empty state', async ({ page }) => {
    await page.goto('/?q=qxzjvkwm');
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot('empty-state.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('search tips open', async ({ page }) => {
    await page.goto('/?q=trust');
    await page.waitForSelector('.result-card', { timeout: 10000 });
    // Click the ? icon to open tips
    await page.locator('.search-tips-trigger').click();
    await page.waitForTimeout(500); // animation
    await expect(page).toHaveScreenshot('search-tips-open.png', {
      maxDiffPixelRatio: 0.02,
      mask: [
        page.locator('.result-snippet'),
        page.locator('.result-date'),
        page.locator('.density-result-count'),
      ],
    });
  });
});
