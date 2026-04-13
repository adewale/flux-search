/**
 * Density strip alignment test — verifies that the result count
 * and Y-axis label are visually left-aligned by checking their
 * rendered bounding box positions in the browser.
 */
import { test, expect } from '@playwright/test';

test.describe('density strip alignment', () => {
  test('result count and Y-axis label are left-aligned', async ({ page }) => {
    await page.goto('/?q=war');
    await page.waitForSelector('.density-bar', { timeout: 10000 });

    // Get the left edge of "65 results" text
    const countLeft = await page.locator('.density-result-count').evaluate(el => {
      return el.getBoundingClientRect().left;
    });

    // Get the left edge of the Y-axis label ("8") inside the SVG
    const axisLabelLeft = await page.locator('.density-axis-label').first().evaluate(el => {
      return el.getBoundingClientRect().left;
    });

    // They should be within 4px of each other
    expect(Math.abs(countLeft - axisLabelLeft)).toBeLessThan(4);
  });

  test('Y-axis line aligns with the left edge of the first bar', async ({ page }) => {
    await page.goto('/?q=war');
    await page.waitForSelector('.density-bar', { timeout: 10000 });

    const axisLineLeft = await page.locator('.density-axis-line').evaluate(el => {
      return el.getBoundingClientRect().left;
    });

    const firstBarLeft = await page.locator('.density-bar').first().evaluate(el => {
      return el.getBoundingClientRect().left;
    });

    // Axis line should be at or within 2px of the first bar's left edge
    expect(Math.abs(axisLineLeft - firstBarLeft)).toBeLessThan(2);
  });

  test('baseline extends to or past the rightmost bar', async ({ page }) => {
    await page.goto('/?q=war');
    await page.waitForSelector('.density-bar', { timeout: 10000 });

    const baselineRight = await page.locator('.density-baseline').evaluate(el => {
      return el.getBoundingClientRect().right;
    });

    const lastBarRight = await page.locator('.density-bar').last().evaluate(el => {
      return el.getBoundingClientRect().right;
    });

    expect(baselineRight).toBeGreaterThanOrEqual(lastBarRight);
  });
});
