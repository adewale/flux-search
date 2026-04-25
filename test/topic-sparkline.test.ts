/**
 * Sparkline geometry for the topic detail page. Pure transform from
 * timeline rows to plotted points so it can be unit-tested without DOM.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
// @ts-ignore — JS module
import { computeSparkline } from '../frontend/js/lib/topic-sparkline.js';

const TIMELINE = [
  { year: 2023, month: 1, occurrences: 1 },
  { year: 2023, month: 6, occurrences: 3 },
  { year: 2024, month: 1, occurrences: 5 },
  { year: 2024, month: 6, occurrences: 2 },
];

describe('computeSparkline', () => {
  it('returns one point per timeline row', () => {
    const out = computeSparkline(TIMELINE, 200, 40);
    expect(out.points).toHaveLength(4);
  });

  it('first point sits at x=0 and last at x=width', () => {
    const out = computeSparkline(TIMELINE, 200, 40);
    expect(out.points[0].x).toBe(0);
    expect(out.points[out.points.length - 1].x).toBe(200);
  });

  it('peak occurrences map to y=0; zero maps to y=height', () => {
    const out = computeSparkline(TIMELINE, 200, 40);
    const peak = out.points.find(p => p.occurrences === 5)!;
    expect(peak.y).toBe(0);
    const minY = Math.min(...out.points.map(p => p.y));
    expect(minY).toBe(0);
    expect(Math.max(...out.points.map(p => p.y))).toBeLessThanOrEqual(40);
  });

  it('handles a single-row timeline by centering the point', () => {
    const out = computeSparkline([{ year: 2024, month: 1, occurrences: 7 }], 100, 30);
    expect(out.points).toHaveLength(1);
    expect(out.points[0].x).toBe(50);
  });

  it('returns empty points for empty timeline', () => {
    expect(computeSparkline([], 100, 30).points).toEqual([]);
  });

  it('produces a valid SVG path string', () => {
    const out = computeSparkline(TIMELINE, 200, 40);
    expect(out.path).toMatch(/^M\s*-?\d/);
    expect(out.path.split(/[ML]/).filter(Boolean)).toHaveLength(4);
  });

  it('PBT: all coordinates stay inside the bounding box', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          year: fc.integer({ min: 2020, max: 2026 }),
          month: fc.integer({ min: 1, max: 12 }),
          occurrences: fc.integer({ min: 0, max: 100 }),
        }), { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 50, max: 600 }),
        fc.integer({ min: 10, max: 80 }),
        (rows, w, h) => {
          const out = computeSparkline(rows, w, h);
          for (const p of out.points) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(w);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(h);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
