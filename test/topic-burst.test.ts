import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeBurstScore } from '../src/lib/topic-burst';

describe('computeBurstScore', () => {
  it('returns 0 for an empty timeline', () => {
    expect(computeBurstScore([])).toEqual({ burstScore: 0, burstQuarter: null, total: 0 });
  });

  it('returns 1 for a uniform distribution', () => {
    const out = computeBurstScore([
      { year: 2024, month: 2, occurrences: 1 }, // Q1
      { year: 2024, month: 5, occurrences: 1 }, // Q2
      { year: 2024, month: 8, occurrences: 1 }, // Q3
      { year: 2024, month: 11, occurrences: 1 }, // Q4
    ]);
    expect(out.burstScore).toBe(1);
    expect(out.total).toBe(4);
  });

  it('returns 1 for a single observed quarter (no spread to compare against)', () => {
    const out = computeBurstScore([
      { year: 2024, month: 2, occurrences: 10 },
      { year: 2024, month: 5, occurrences: 0 },
      { year: 2024, month: 8, occurrences: 0 },
      { year: 2024, month: 11, occurrences: 0 },
    ]);
    // Only one non-zero quarter → span=1, mean=10, max=10, burst=1.
    expect(out.burstScore).toBe(1);
    expect(out.burstQuarter).toBe('2024-Q1');
  });

  it('returns ~N for a spike at the end of an N-quarter active range', () => {
    const out = computeBurstScore([
      { year: 2023, month: 2, occurrences: 1 },  // Q1 2023
      { year: 2023, month: 11, occurrences: 0 }, // Q4 2023 (silent)
      { year: 2024, month: 2, occurrences: 10 }, // Q1 2024 (spike)
    ]);
    // span = Q1 2024 - Q1 2023 + 1 = 5 quarters. total=11, mean=11/5=2.2, max=10 → 4.55
    expect(out.burstScore).toBeGreaterThan(4);
    expect(out.burstQuarter).toBe('2024-Q1');
  });

  it('captures the high-burst quarter even when others have non-zero share', () => {
    const out = computeBurstScore([
      { year: 2023, month: 1, occurrences: 1 },
      { year: 2023, month: 4, occurrences: 1 },
      { year: 2024, month: 2, occurrences: 8 }, // big spike Q1 2024
    ]);
    // total=10, 3 buckets → mean=3.33; max=8 → burst≈2.4
    expect(out.burstScore).toBeGreaterThan(2);
    expect(out.burstQuarter).toBe('2024-Q1');
  });

  it('aggregates months within a quarter', () => {
    const out = computeBurstScore([
      { year: 2024, month: 1, occurrences: 2 },
      { year: 2024, month: 2, occurrences: 3 },
      { year: 2024, month: 3, occurrences: 1 },
    ]);
    // single bucket 2024-Q1 with 6 → burst 1
    expect(out.burstQuarter).toBe('2024-Q1');
    expect(out.total).toBe(6);
    expect(out.burstScore).toBe(1);
  });

  it('PBT: burst score is bounded by the span between first and last quarter', () => {
    fc.assert(
      fc.property(fc.array(fc.record({
        year: fc.integer({ min: 2020, max: 2026 }),
        month: fc.integer({ min: 1, max: 12 }),
        occurrences: fc.integer({ min: 0, max: 100 }),
      }), { maxLength: 30 }), (rows) => {
        const out = computeBurstScore(rows);
        expect(out.burstScore).toBeGreaterThanOrEqual(0);
        // burst = max / mean = max / (total / span) <= span when max <= total
        const idxs = rows.filter(r => r.occurrences > 0)
          .map(r => r.year * 4 + Math.floor((r.month - 1) / 3));
        const span = idxs.length === 0 ? 0 : Math.max(...idxs) - Math.min(...idxs) + 1;
        expect(out.burstScore).toBeLessThanOrEqual(span + 0.0001);
      }),
      { numRuns: 200 },
    );
  });
});
