/**
 * Acceptance tests for the dismiss widget (clear ✕ button).
 *
 * Runs under both the `desktop` and `mobile` projects defined in
 * playwright.config.ts. Mobile-specific assertions are gated on the
 * project name.
 */

import { test, expect } from '@playwright/test';

test.describe('Dismiss widget — logic', () => {
  test('clearing an existing query leaves the input empty and stays empty', async ({ page }) => {
    await page.goto('/?q=trust');

    // Wait for results from the initial query.
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });

    const clear = page.locator('#search-clear');
    await expect(clear).toBeVisible();

    await clear.click();

    // Input must actually be empty.
    await expect(page.locator('#search-input')).toHaveValue('');

    // It must STAY empty — i.e. nothing auto-populates it after the click.
    await page.waitForTimeout(800);
    await expect(page.locator('#search-input')).toHaveValue('');

    // URL no longer has ?q=
    expect(new URL(page.url()).searchParams.get('q')).toBeNull();

    // Landing quote should be visible, no results list.
    await expect(page.locator('#results .result-card')).toHaveCount(0);
  });

  test('clear button is hidden when the input is empty', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#search-clear')).toBeHidden();
    await page.fill('#search-input', 'x');
    await expect(page.locator('#search-clear')).toBeVisible();
  });

  test('dismiss is idempotent', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });

    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');
    // Second click is a no-op (button is hidden; force to simulate rapid tap).
    await page.locator('#search-clear').click({ force: true }).catch(() => {});
    await expect(page.locator('#search-input')).toHaveValue('');
  });

  test('back-button after dismiss does not resurrect the old query', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');
    await page.goBack().catch(() => {});
    // Either we're at ?q=trust (prior URL) or at empty; in either case
    // the input reflects the URL, not a spurious auto-search.
    const url = new URL(page.url());
    const q = url.searchParams.get('q') || '';
    await expect(page.locator('#search-input')).toHaveValue(q);
  });
});

test.describe('Dismiss widget — mobile ergonomics', () => {
  test('clear button meets 44×44 minimum hit area', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only');
    await page.goto('/?q=trust');
    const clear = page.locator('#search-clear');
    await expect(clear).toBeVisible();
    const box = await clear.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('clear button is fully visible (not half-opacity)', async ({ page }) => {
    await page.goto('/?q=trust');
    const clear = page.locator('#search-clear');
    const opacity = await clear.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeGreaterThanOrEqual(0.95);
  });

  test('long query does not overlap the clear button', async ({ page }) => {
    await page.goto('/');
    const longQuery = 'institutional trust before:2024-01-01 section:essays issue:198';
    await page.fill('#search-input', longQuery);
    const inputBox = await page.locator('#search-input').boundingBox();
    const clearBox = await page.locator('#search-clear').boundingBox();
    expect(inputBox && clearBox).toBeTruthy();
    // The input's reserved right padding must leave room for the ✕: the
    // clear button must sit within the input's right edge.
    expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(
      inputBox!.x + inputBox!.width + 1,
    );
  });

  test('dismiss on mobile blurs input (dismisses soft keyboard)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile-only');
    await page.goto('/?q=trust');
    await page.locator('#search-input').focus();
    await page.locator('#search-clear').click();
    const active = await page.evaluate(() => document.activeElement?.id || '');
    expect(active).not.toBe('search-input');
  });

  test('dismiss on desktop keeps input focused', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop-only');
    await page.goto('/?q=trust');
    await page.locator('#search-clear').click();
    const active = await page.evaluate(() => document.activeElement?.id || '');
    expect(active).toBe('search-input');
  });
});
