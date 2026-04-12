import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityBars } from '../frontend/js/lib/density.js';

describe('computeDensityBars', () => {
  it('returns one bar per year with results', () => {
    const result = computeDensityBars({ 2021: 1, 2022: 1, 2023: 1 }, 300, 24);
    expect(result.bars).toHaveLength(3);
    expect(result.bars.map((b: any) => b.year)).toEqual([2021, 2022, 2023]);
  });

  it('skips years with zero results', () => {
    const result = computeDensityBars({ 2021: 1, 2023: 1, 2025: 1 }, 300, 24);
    expect(result.bars).toHaveLength(3);
    expect(result.bars.map((b: any) => b.year)).toEqual([2021, 2023, 2025]);
    // No bars at 2022 or 2024
  });

  it('bar height is proportional to count relative to max', () => {
    const result = computeDensityBars({ 2021: 2, 2022: 4, 2023: 1 }, 300, 24);
    const heights = result.bars.map((b: any) => b.barHeight);
    expect(heights[1]).toBe(24);  // max count = full height
    expect(heights[0]).toBe(12);  // half of max
    expect(heights[2]).toBe(6);   // quarter of max
  });

  it('returns empty for empty distribution', () => {
    const result = computeDensityBars({}, 300, 24);
    expect(result.bars).toHaveLength(0);
  });

  it('single year produces one bar', () => {
    const result = computeDensityBars({ 2023: 5 }, 300, 24);
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].year).toBe(2023);
    expect(result.bars[0].barHeight).toBe(24);
  });

  it('bar positions span the full width', () => {
    const result = computeDensityBars({ 2021: 1, 2025: 1 }, 300, 24);
    expect(result.bars[0].x).toBe(0);
    expect(result.bars[1].x).toBe(300);
  });

  it('allYears includes every year in the range', () => {
    const result = computeDensityBars({ 2021: 1, 2024: 1 }, 300, 24);
    expect(result.allYears).toEqual([2021, 2022, 2023, 2024]);
  });

  it('barWidth is positive and proportional to span', () => {
    const narrow = computeDensityBars({ 2021: 1, 2025: 1 }, 300, 24);
    const wide = computeDensityBars({ 2021: 1, 2022: 1 }, 300, 24);
    expect(narrow.barWidth).toBeGreaterThan(0);
    expect(wide.barWidth).toBeGreaterThan(narrow.barWidth);
  });
});
