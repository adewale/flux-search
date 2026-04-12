import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityArea } from '../frontend/js/lib/density.js';

describe('computeDensityArea', () => {
  // --- Shape: connected area for consecutive years, gaps for missing years ---

  it('consecutive years with data produce a connected area (no zero-drops between them)', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 14, 2022: 21, 2023: 5, 2024: 4, 2025: 5, 2026: 1 }, 300, H);
    // All 6 years have data — points should follow data heights without returning to baseline between them
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(6);
    // No baseline points between consecutive data years
    // The pattern should be: baseline, peak, peak, peak, ..., peak, baseline
    // (baseline only at the very start and end, not between data years)
    const baselineBetweenPeaks = result.points.filter((p: any, i: number) => {
      if (p.y !== H) return false;
      const prev = result.points[i - 1];
      const next = result.points[i + 1];
      return prev && next && prev.y < H && next.y < H;
    });
    expect(baselineBetweenPeaks).toHaveLength(0);
  });

  it('non-consecutive years have zero-drops at missing years', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 5, 2023: 10, 2025: 3 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(3);
    // Years 2022 and 2024 should be at baseline
    const baselinePoints = result.points.filter((p: any) => p.y === H);
    expect(baselinePoints.length).toBeGreaterThan(0);
  });

  // --- Scale: minimum Y-scale prevents single results from filling full height ---

  it('single-result years do not fill full chart height', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 1, 2022: 1, 2023: 1 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    // With minScale, 1 result should NOT be at y=0 (full height)
    for (const p of peaks) {
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it('high counts still reach full height', () => {
    const H = 24;
    const result = computeDensityArea({ 2022: 20 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].y).toBe(0); // max count should be at full height
  });

  it('peak height is proportional to count with varying distribution', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 10, 2022: 20, 2023: 5 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    // 20 is max → y=0; 10 is half → y=12; 5 is quarter → y=18
    const sorted = [...peaks].sort((a: any, b: any) => a.y - b.y);
    expect(sorted[0].y).toBe(0);   // max
    expect(sorted[1].y).toBe(12);  // half
    expect(sorted[2].y).toBe(18);  // quarter
  });

  // --- Edge cases ---

  it('returns empty for empty distribution', () => {
    const result = computeDensityArea({}, 300, 24);
    expect(result.points).toHaveLength(0);
  });

  it('single year produces a spike with baseline on either side', () => {
    const H = 24;
    const result = computeDensityArea({ 2023: 10 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(1);
  });

  it('allYears includes every year in the range', () => {
    const result = computeDensityArea({ 2021: 1, 2024: 1 }, 300, 24);
    expect(result.allYears).toEqual([2021, 2022, 2023, 2024]);
  });
});
