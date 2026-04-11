/**
 * RED tests for query refinement logic.
 * Clicking refinement buttons should not duplicate operators.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { appendOperator } from '../src/lib/query-refinement';

describe('appendOperator', () => {
  it('appends operator to query without existing operators', () => {
    expect(appendOperator('trust', 'section:lead_essay')).toBe('trust section:lead_essay');
  });

  it('replaces existing same-type operator', () => {
    expect(appendOperator('trust section:signposts', 'section:lead_essay')).toBe('trust section:lead_essay');
  });

  it('does not duplicate when clicking same operator twice', () => {
    const q1 = appendOperator('trust', 'section:lead_essay');
    const q2 = appendOperator(q1, 'section:lead_essay');
    expect(q2).toBe('trust section:lead_essay');
  });

  it('does not duplicate when clicking three times', () => {
    let q = 'trust';
    q = appendOperator(q, 'year:2023');
    q = appendOperator(q, 'year:2023');
    q = appendOperator(q, 'year:2023');
    expect(q).toBe('trust year:2023');
  });

  it('preserves different operators', () => {
    let q = 'trust';
    q = appendOperator(q, 'section:lead_essay');
    q = appendOperator(q, 'year:2023');
    expect(q).toBe('trust section:lead_essay year:2023');
  });

  it('replaces value of existing operator', () => {
    expect(appendOperator('trust year:2022', 'year:2023')).toBe('trust year:2023');
  });

  it('handles quoted phrases in the query', () => {
    expect(appendOperator('"exact phrase"', 'section:lens')).toBe('"exact phrase" section:lens');
  });

  it('handles empty query', () => {
    expect(appendOperator('', 'year:2023')).toBe('year:2023');
  });

  it('PBT: result never contains duplicate operator keys', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ]{0,20}$/),
        fc.constantFrom('section:lead_essay', 'year:2023', 'before:2024'),
        fc.integer({ min: 1, max: 5 }),
        (base, op, clicks) => {
          let q = base;
          for (let i = 0; i < clicks; i++) {
            q = appendOperator(q, op);
          }
          const key = op.split(':')[0];
          const occurrences = (q.match(new RegExp(key + ':', 'g')) || []).length;
          expect(occurrences).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('PBT: free text is preserved through multiple refinements', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        fc.constantFrom('section:lens', 'year:2024', 'before:2025'),
        (word, op) => {
          const result = appendOperator(word, op);
          expect(result).toContain(word);
        }
      ),
      { numRuns: 50 }
    );
  });
});
