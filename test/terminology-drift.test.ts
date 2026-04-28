import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeTerminologyDrift } from '../src/lib/terminology-drift';

describe('computeTerminologyDrift', () => {
  it('returns empty for missing keyword or samples', () => {
    expect(computeTerminologyDrift('', [])).toEqual([]);
    expect(computeTerminologyDrift('foo', [])).toEqual([]);
    expect(computeTerminologyDrift('foo', [
      { text: 'no mention here', year: 2024, month: 1 },
    ])).toEqual([]);
  });

  it('buckets by quarter and shows distinctive context per bucket', () => {
    // "trust" appears with "institutional" in early 2024; with "ai" in late 2024.
    const samples = [
      { text: 'institutional trust collapses across institutional trust networks', year: 2024, month: 2 },
      { text: 'institutional trust depends on institutional norms', year: 2024, month: 3 },
      { text: 'ai trust signals shift; trust ai depends on alignment', year: 2024, month: 11 },
      { text: 'ai trust signals also depend on training data trust', year: 2024, month: 12 },
    ];
    const drift = computeTerminologyDrift('trust', samples, { topK: 5 });
    expect(drift.length).toBe(2);

    const q1 = drift.find(b => b.quarter === 1)!;
    const q4 = drift.find(b => b.quarter === 4)!;
    expect(q1.topContextWords.find(w => w.word === 'institutional')).toBeDefined();
    expect(q4.topContextWords.find(w => w.word === 'ai')).toBeDefined();
  });

  it('orders buckets chronologically', () => {
    const samples = [
      { text: 'big ideas about trust here', year: 2024, month: 11 },
      { text: 'big ideas about trust there', year: 2024, month: 11 },
      { text: 'small ideas about trust there', year: 2023, month: 1 },
      { text: 'small ideas about trust here', year: 2023, month: 1 },
    ];
    const drift = computeTerminologyDrift('trust', samples);
    expect(drift[0].year).toBe(2023);
    expect(drift[drift.length - 1].year).toBe(2024);
  });

  it('respects windowSize', () => {
    const text = 'one two three four five trust six seven eight nine ten';
    // window=2 → only "four five" and "six seven" should appear
    const drift = computeTerminologyDrift('trust', [
      { text, year: 2024, month: 1 },
      { text, year: 2024, month: 1 },
    ], { windowSize: 2, minContextOccurrences: 2 });
    if (drift.length === 0) return;
    const ctxWords = drift[0].topContextWords.map(w => w.word);
    expect(ctxWords).not.toContain('one');
    expect(ctxWords).not.toContain('ten');
  });

  it('PBT: never throws on adversarial samples', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.array(fc.record({
          text: fc.string({ maxLength: 200 }),
          year: fc.integer({ min: 2020, max: 2026 }),
          month: fc.integer({ min: 1, max: 12 }),
        }), { maxLength: 10 }),
        (k, samples) => {
          expect(() => computeTerminologyDrift(k, samples)).not.toThrow();
        }),
      { numRuns: 100 },
    );
  });
});
