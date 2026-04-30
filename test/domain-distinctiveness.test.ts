import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeDomainDistinctivenessBoost } from '../src/lib/domain-distinctiveness';

function boost(keyword: string, protectedTopic = false, docFrequency = 4): number {
  return computeDomainDistinctivenessBoost({
    keyword,
    docFrequency,
    totalIssues: 236,
    ngramSize: keyword.split(/\s+/).length,
    protectedTopic,
  }).boost;
}

describe('domain-distinctiveness topic scoring', () => {
  it('demotes general-English phrases relative to Flux-characteristic phrases', () => {
    expect(boost('systems thinking')).toBeGreaterThan(boost('many americans'));
    expect(boost('mental models')).toBeGreaterThan(boost('complex times'));
    expect(boost('large language models')).toBeGreaterThan(boost('world war'));
  });

  it('does not penalize protected short topics, publications, blogs, and book titles below neutral', () => {
    for (const keyword of [
      'crypto',
      'rest of world',
      'not boring',
      'crooked timber',
      'simple habits for complex times',
    ]) {
      expect(boost(keyword, true)).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('increases monotonically with Flux document frequency', () => {
    expect(boost('systems thinking', false, 12)).toBeGreaterThanOrEqual(boost('systems thinking', false, 3));
  });

  it('is bounded and finite for arbitrary phrases', () => {
    fc.assert(fc.property(fc.string(), s => {
      const result = computeDomainDistinctivenessBoost({
        keyword: s,
        docFrequency: 3,
        totalIssues: 236,
        ngramSize: Math.max(1, s.trim().split(/\s+/).filter(Boolean).length),
        protectedTopic: false,
      });
      expect(Number.isFinite(result.boost)).toBe(true);
      expect(result.boost).toBeGreaterThanOrEqual(0.35);
      expect(result.boost).toBeLessThanOrEqual(2.5);
    }), { numRuns: 100 });
  });
});
