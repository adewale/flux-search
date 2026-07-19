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
import { installVisualApiFixtures } from './visual-api-fixtures';

test.beforeEach(async ({ page }) => {
  await installVisualApiFixtures(page);
});

test.describe('visual regression', () => {
  test('search results: crypto', async ({ page }) => {
    await page.goto('/?q=crypto');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loading')).toBeHidden();
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
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loading')).toBeHidden();
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
    await expect(page.locator('#issue-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.issue-topics-mobile, .issue-topics-panel').first()).toBeAttached();
    await expect(page).toHaveScreenshot('issue-198.png', {
      maxDiffPixelRatio: 0.02,
      mask: [
        page.locator('.section-body'),
      ],
    });
  });

  test('empty state', async ({ page }) => {
    await page.goto('/?q=qxzjvkwm');
    await expect(page.locator('#empty-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page).toHaveScreenshot('empty-state.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('search tips open', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loading')).toBeHidden();
    await page.locator('.search-tips-trigger').click();
    await expect(page.locator('.search-tips')).toHaveAttribute('open', '');
    await expect(page.locator('.search-tips-panel')).toBeVisible();
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
