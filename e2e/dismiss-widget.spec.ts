/**
 * Acceptance tests for the dismiss widget (clear ✕ button).
 *
 * Runs under both the `desktop` and `mobile` projects defined in
 * playwright.config.ts. Mobile-specific assertions are gated on the
 * project name.
 */

import { test, expect } from '@playwright/test';

test.describe('Dismiss widget — logic (in-place clear)', () => {
  test('dismiss empties the input but leaves results on screen', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    const resultCountBefore = await page.locator('.result-card').count();

    await page.locator('#search-clear').click();

    // Input is empty…
    await expect(page.locator('#search-input')).toHaveValue('');
    // …and stays empty (no async auto-population).
    await page.waitForTimeout(800);
    await expect(page.locator('#search-input')).toHaveValue('');

    // Results are still showing — the SAME results.
    await expect(page.locator('.result-card')).toHaveCount(resultCountBefore);

    // URL is untouched — dismiss is a local action, not a navigation.
    expect(new URL(page.url()).searchParams.get('q')).toBe('trust');

    // The clear button is hidden again (nothing to clear).
    await expect(page.locator('#search-clear')).toBeHidden();
  });

  test('dismiss does NOT hide the quote when it was showing (cold-start)', async ({ page }) => {
    await page.goto('/');
    // Wait for the cold-start landing quote to load.
    await page.waitForSelector('#landing-quote:not([hidden])', { timeout: 5_000 }).catch(() => {});
    // And for the featured latest-issue results to populate.
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-clear').click();

    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#landing-quote')).toBeVisible();
    await expect(page.locator('.result-card').first()).toBeVisible();
  });

  test('submitting a new query from BROWSING transitions cleanly', async ({ page }) => {
    await page.goto('/?q=trust');
    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#search-clear').click();
    await expect(page.locator('#search-input')).toHaveValue('');

    await page.fill('#search-input', 'hope');
    await page.press('#search-input', 'Enter');

    await expect(page.locator('.result-card').first()).toBeVisible({ timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('q')).toBe('hope');
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
    // Second click (forced — it's hidden) remains a no-op.
    await page.locator('#search-clear').click({ force: true }).catch(() => {});
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('.result-card').first()).toBeVisible();
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
