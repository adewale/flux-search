import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityBars } from '../frontend/js/lib/density.js';

describe('computeDensityBars', () => {
  it('returns one bar per quarter with results', () => {
    const result = computeDensityBars(
      { '2022-Q1': { lead_essay: 1 }, '2022-Q2': { signposts: 2, lens: 1 }, '2022-Q4': { lead_essay: 2 } }, 300, 48
    );
    expect(result.bars).toHaveLength(3);
  });

  it('bar height is total count across all sections', () => {
    const H = 48;
    const result = computeDensityBars(
      { '2022-Q1': { lead_essay: 3, signposts: 2 }, '2022-Q2': { lead_essay: 10 } }, 300, H
    );
    // Q1 total=5, Q2 total=10; effectiveMax=10
    expect(result.bars[0].totalCount).toBe(5);
    expect(result.bars[1].totalCount).toBe(10);
    expect(result.bars[1].height).toBe(H); // max → full height
  });

  it('bars carry section segments for stacked rendering', () => {
    const result = computeDensityBars(
      { '2022-Q1': { lead_essay: 3, signposts: 2 } }, 300, 48
    );
    const bar = result.bars[0];
    expect(bar.segments).toHaveLength(2);
    expect(bar.segments[0].section).toBe('lead_essay');
    expect(bar.segments[0].count).toBe(3);
    expect(bar.segments[1].section).toBe('signposts');
    expect(bar.segments[1].count).toBe(2);
  });

  it('single results do not fill full height due to minimum scale', () => {
    const H = 48;
    const result = computeDensityBars(
      { '2023-Q1': { other: 1 }, '2023-Q2': { other: 1 } }, 300, H
    );
    for (const b of result.bars) {
      expect(b.height).toBeLessThan(H);
    }
  });

  it('returns year tick positions', () => {
    const result = computeDensityBars(
      { '2022-Q1': { lead_essay: 1 }, '2023-Q4': { signposts: 2 } }, 300, 48
    );
    expect(result.yearTicks.length).toBeGreaterThanOrEqual(2);
    expect(result.yearTicks[0].year).toBe(2022);
  });

  it('first year tick x is >= 0 (never off the left edge)', () => {
    // 2021-Q2 is the first data point; the year tick for 2021 should
    // be clamped to x=0, not negative.
    const result = computeDensityBars(
      { '2021-Q2': { signposts: 1 } }, 560, 80
    );
    for (const tick of result.yearTicks) {
      expect(tick.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns empty for empty distribution', () => {
    const result = computeDensityBars({}, 300, 48);
    expect(result.bars).toHaveLength(0);
  });

  it('right edge caps at today', () => {
    const now = new Date(2026, 3, 12); // April 2026 = Q2
    const result = computeDensityBars(
      { '2021-Q1': { other: 1 } }, 300, 48, now
    );
    // Year ticks should go up to 2026, not stop at 2021
    expect(result.yearTicks[result.yearTicks.length - 1].year).toBe(2026);
  });
});
