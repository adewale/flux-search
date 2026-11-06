import { test, expect } from '@playwright/test';
import { installVisualApiFixtures } from './visual-api-fixtures';

test('the topics rail does not steal the article measure and collapses on handhelds', async ({ page }) => {
  await installVisualApiFixtures(page);
  for (const width of [1280, 1600, 899, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/issues/issue/198#lead_essay');
    const grid = page.locator('.issue-body-grid');
    await expect(page.locator('#issue-page')).toBeVisible();
    await expect(grid).toBeVisible();
    const measured = await grid.evaluate(element => {
      const article = element.firstElementChild;
      if (!(article instanceof HTMLElement)) throw new Error('missing issue article');
      const rectangle = article.getBoundingClientRect();
      return { width: rectangle.width, x: rectangle.x, right: rectangle.right, measure: 640 };
    });
    if (width >= 900) {
      await expect(page.locator('#issue-topics-side')).toBeVisible();
      const rail = await page.locator('#issue-topics-side').boundingBox();
      expect(rail).not.toBeNull();
      expect(measured.width).toBeCloseTo(measured.measure, 0);
      expect(rail!.x).toBeGreaterThanOrEqual(measured.right);
    } else {
      await expect(page.locator('#issue-topics-side')).toBeHidden();
      expect(measured.x).toBeGreaterThanOrEqual(0);
      expect(measured.right).toBeLessThanOrEqual(width);
      expect(measured.width).toBeLessThanOrEqual(measured.measure);
    }
  }
});
