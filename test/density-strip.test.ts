import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityArea } from '../frontend/js/lib/density.js';

describe('computeDensityArea', () => {
  it('consecutive years produce separate peaks with zero-drops between them', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 1, 2022: 1, 2023: 1 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(3);
    // Every peak must be flanked by baseline points
    for (let i = 0; i < result.points.length; i++) {
      if (result.points[i].y < H) {
        if (i > 0) expect(result.points[i - 1].y).toBe(H);
        if (i < result.points.length - 1) expect(result.points[i + 1].y).toBe(H);
      }
    }
  });

  it('sparse years have baseline between peaks', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 1, 2025: 1 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(2);
    // Years 2022-2024 produce baseline points between the two peaks
    const baselines = result.points.filter((p: any) => p.y === H);
    expect(baselines.length).toBeGreaterThanOrEqual(3);
  });

  it('peak height is proportional to count', () => {
    const H = 24;
    const result = computeDensityArea({ 2021: 2, 2022: 4 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(2);
    // max count (4) → y=0, half count (2) → y=12
    const peakValues = peaks.map((p: any) => p.y).sort((a: number, b: number) => a - b);
    expect(peakValues[0]).toBe(0);
    expect(peakValues[1]).toBe(12);
  });

  it('returns empty for empty distribution', () => {
    const result = computeDensityArea({}, 300, 24);
    expect(result.points).toHaveLength(0);
  });

  it('single year produces a spike', () => {
    const H = 24;
    const result = computeDensityArea({ 2023: 5 }, 300, H);
    const peaks = result.points.filter((p: any) => p.y < H);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].y).toBe(0);
  });

  it('allYears includes every year in the range', () => {
    const result = computeDensityArea({ 2021: 1, 2024: 1 }, 300, 24);
    expect(result.allYears).toEqual([2021, 2022, 2023, 2024]);
  });
});
