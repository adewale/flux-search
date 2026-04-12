import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityBars } from '../frontend/js/lib/density.js';

describe('computeDensityBars', () => {
  it('returns one bar per quarter with results', () => {
    const result = computeDensityBars(
      { '2022-Q1': 1, '2022-Q2': 3, '2022-Q4': 2 }, 300, 48
    );
    expect(result.bars).toHaveLength(3);
  });

  it('bar height is proportional to count with minimum scale', () => {
    const H = 48;
    const result = computeDensityBars(
      { '2022-Q1': 2, '2022-Q2': 10, '2022-Q3': 5 }, 300, H
    );
    // maxCount=10, effectiveMax=max(10,5)=10
    const heights = result.bars.map((b: any) => b.height);
    expect(heights[1]).toBe(H);      // max → full height
    expect(heights[0]).toBe(H * 0.2); // 2/10
    expect(heights[2]).toBe(H * 0.5); // 5/10
  });

  it('single results do not fill full height due to minimum scale', () => {
    const H = 48;
    const result = computeDensityBars(
      { '2023-Q1': 1, '2023-Q2': 1 }, 300, H
    );
    // effectiveMax=5, so 1/5 = 20%
    for (const b of result.bars) {
      expect(b.height).toBeLessThan(H);
    }
  });

  it('bars carry their count for direct labeling', () => {
    const result = computeDensityBars(
      { '2022-Q1': 7, '2023-Q3': 3 }, 300, 48
    );
    expect(result.bars[0].count).toBe(7);
    expect(result.bars[1].count).toBe(3);
  });

  it('bars carry their quarter key for labeling', () => {
    const result = computeDensityBars(
      { '2022-Q1': 1, '2023-Q4': 2 }, 300, 48
    );
    expect(result.bars[0].key).toBe('2022-Q1');
    expect(result.bars[1].key).toBe('2023-Q4');
  });

  it('returns year tick positions for the x-axis', () => {
    const result = computeDensityBars(
      { '2022-Q1': 1, '2023-Q4': 2 }, 300, 48
    );
    // Should have year ticks for 2022 and 2023 at least
    expect(result.yearTicks.length).toBeGreaterThanOrEqual(2);
    expect(result.yearTicks[0].year).toBe(2022);
  });

  it('returns empty for empty distribution', () => {
    const result = computeDensityBars({}, 300, 48);
    expect(result.bars).toHaveLength(0);
  });

  it('bar width leaves gaps between bars', () => {
    const result = computeDensityBars(
      { '2022-Q1': 1, '2022-Q2': 1, '2022-Q3': 1, '2022-Q4': 1 }, 300, 48
    );
    // Bar width should be less than the spacing between bars
    const spacing = result.bars[1].x - result.bars[0].x;
    expect(result.barWidth).toBeLessThan(spacing);
  });
});
