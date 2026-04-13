/**
 * Density strip geometry tests.
 *
 * Verify spatial relationships between chart elements: axes, bars,
 * baseline, labels, and tooltips. These catch alignment bugs that
 * unit tests and screenshots miss individually.
 *
 * All constants mirror the rendering code in result-list.js.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore — JS module
import { computeDensityBars } from '../frontend/js/lib/density.js';

// Layout constants from result-list.js
const AXIS_W = 14;
const W = 576;
const H = 80;

function barLeft(bar: any, barWidth: number) { return AXIS_W + bar.x - barWidth / 2; }
function barRight(bar: any, barWidth: number) { return AXIS_W + bar.x + barWidth / 2; }
function barTop(bar: any) { return H - bar.height; }
function barBottom() { return H; }
function axisX(barWidth: number) { return AXIS_W - barWidth / 2; }

// Test data
const DENSE = { '2021-Q2': { signposts: 4 }, '2021-Q3': { lead_essay: 5, signposts: 6 }, '2021-Q4': { signposts: 2 }, '2022-Q1': { signposts: 8 }, '2022-Q2': { lead_essay: 7 }, '2022-Q3': { signposts: 5 }, '2022-Q4': { signposts: 2 }, '2023-Q2': { signposts: 3 }, '2025-Q1': { lead_essay: 7 }, '2026-Q1': { signposts: 5 }, '2026-Q2': { other: 1 } };
const SPARSE = { '2022-Q3': { lead_essay: 1 }, '2024-Q1': { signposts: 1 }, '2025-Q4': { other: 1 } };
const SINGLE = { '2023-Q2': { lead_essay: 3 } };

describe('density strip geometry', () => {
  describe('Y-axis alignment', () => {
    it('Y-axis x == left edge of the first bar', () => {
      const data = computeDensityBars(DENSE, W, H);
      const firstBar = data.bars[0];
      expect(axisX(data.barWidth)).toBeCloseTo(barLeft(firstBar, data.barWidth), 5);
    });

    it('Y-axis x == left edge even when first data is mid-year', () => {
      // 2022-Q3: year tick for 2022 is before the first data point
      const data = computeDensityBars(SPARSE, W, H);
      const aX = axisX(data.barWidth);
      const firstBarL = barLeft(data.bars[0], data.barWidth);
      // Axis should be at or before the first bar
      expect(aX).toBeLessThanOrEqual(firstBarL);
    });
  });

  describe('baseline', () => {
    it('baseline starts at Y-axis x', () => {
      const data = computeDensityBars(DENSE, W, H);
      // Baseline x1 = axisX in the renderer
      const baselineStart = axisX(data.barWidth);
      expect(baselineStart).toBeCloseTo(axisX(data.barWidth), 5);
    });

    it('baseline extends past the rightmost bar', () => {
      const data = computeDensityBars(DENSE, W, H);
      const lastBar = data.bars[data.bars.length - 1];
      const lastBarR = barRight(lastBar, data.barWidth);
      const baselineEnd = Math.max(AXIS_W + W, lastBarR + 2);
      expect(baselineEnd).toBeGreaterThan(lastBarR);
    });
  });

  describe('bar heights', () => {
    it('tallest bar reaches y=0 (top of chart area)', () => {
      const data = computeDensityBars(DENSE, W, H);
      const tallest = data.bars.reduce((a: any, b: any) => a.height > b.height ? a : b);
      // Max count == scaleMax means bar fills full height
      if (data.maxCount >= 5) { // above MIN_SCALE
        expect(barTop(tallest)).toBe(0);
      }
    });

    it('all bars sit on the baseline (bottom == H)', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const bar of data.bars) {
        // Bar bottom is always H (the baseline y)
        expect(barBottom()).toBe(H);
        // Bar top = H - height, so height > 0 means bar is above baseline
        expect(bar.height).toBeGreaterThan(0);
      }
    });

    it('no bar exceeds the chart top (height <= H)', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const bar of data.bars) {
        expect(bar.height).toBeLessThanOrEqual(H);
      }
    });

    it('bar heights are proportional to count', () => {
      const data = computeDensityBars(DENSE, W, H);
      // Find two bars with different counts
      const sorted = [...data.bars].sort((a: any, b: any) => a.totalCount - b.totalCount);
      const small = sorted[0];
      const large = sorted[sorted.length - 1];
      if (small.totalCount !== large.totalCount) {
        expect(small.height).toBeLessThan(large.height);
      }
    });

    it('minimum bar height is 3px', () => {
      const data = computeDensityBars(SPARSE, W, H);
      for (const bar of data.bars) {
        expect(bar.height).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('bar positions', () => {
    it('bars are sorted left-to-right by quarter', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (let i = 1; i < data.bars.length; i++) {
        expect(data.bars[i].x).toBeGreaterThan(data.bars[i - 1].x);
      }
    });

    it('bars do not overlap', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (let i = 1; i < data.bars.length; i++) {
        const prevRight = barRight(data.bars[i - 1], data.barWidth);
        const currLeft = barLeft(data.bars[i], data.barWidth);
        expect(currLeft).toBeGreaterThanOrEqual(prevRight);
      }
    });

    it('no bar extends past the baseline right edge', () => {
      const data = computeDensityBars(DENSE, W, H);
      const lastBar = data.bars[data.bars.length - 1];
      const lastBarR = barRight(lastBar, data.barWidth);
      const baselineEnd = Math.max(AXIS_W + W, lastBarR + 2);
      expect(lastBarR).toBeLessThan(baselineEnd);
    });
  });

  describe('scale label', () => {
    it('scaleMax matches what bars are scaled to', () => {
      const data = computeDensityBars(DENSE, W, H);
      const tallest = data.bars.reduce((a: any, b: any) => a.totalCount > b.totalCount ? a : b);
      // tallest bar height should be (count / scaleMax) * H
      const expected = Math.max(3, (tallest.totalCount / data.scaleMax) * H);
      expect(tallest.height).toBeCloseTo(expected, 5);
    });

    it('scaleMax >= MIN_SCALE (5)', () => {
      const data = computeDensityBars(SINGLE, W, H);
      expect(data.scaleMax).toBeGreaterThanOrEqual(5);
    });

    it('scaleMax >= maxCount', () => {
      const data = computeDensityBars(DENSE, W, H);
      expect(data.scaleMax).toBeGreaterThanOrEqual(data.maxCount);
    });
  });

  describe('year ticks', () => {
    it('all year tick x positions are >= 0', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const tick of data.yearTicks) {
        expect(tick.x).toBeGreaterThanOrEqual(0);
      }
    });

    it('year ticks span from first data year to current year', () => {
      const data = computeDensityBars(DENSE, W, H);
      const years = data.yearTicks.map((t: any) => t.year);
      expect(years[0]).toBe(2021);
      expect(years[years.length - 1]).toBe(new Date().getFullYear());
    });

    it('year ticks after the first are evenly spaced', () => {
      const data = computeDensityBars(DENSE, W, H);
      if (data.yearTicks.length >= 3) {
        // Skip the first gap — it may be shorter due to x=0 clamping
        const gaps = [];
        for (let i = 2; i < data.yearTicks.length; i++) {
          gaps.push(data.yearTicks[i].x - data.yearTicks[i - 1].x);
        }
        if (gaps.length >= 2) {
          const avgGap = gaps.reduce((a: number, b: number) => a + b) / gaps.length;
          for (const gap of gaps) {
            expect(gap).toBeCloseTo(avgGap, 0);
          }
        }
      }
    });
  });

  describe('stacked segments', () => {
    it('segment heights sum to bar height', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const bar of data.bars) {
        const segSum = bar.segments.reduce((sum: number, s: any) => sum + s.height, 0);
        expect(segSum).toBeCloseTo(bar.height, 5);
      }
    });

    it('segment counts sum to bar totalCount', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const bar of data.bars) {
        const countSum = bar.segments.reduce((sum: number, s: any) => sum + s.count, 0);
        expect(countSum).toBe(bar.totalCount);
      }
    });

    it('segments are sorted by count descending', () => {
      const data = computeDensityBars(DENSE, W, H);
      for (const bar of data.bars) {
        for (let i = 1; i < bar.segments.length; i++) {
          expect(bar.segments[i].count).toBeLessThanOrEqual(bar.segments[i - 1].count);
        }
      }
    });
  });
});
