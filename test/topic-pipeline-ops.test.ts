import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { corpusDistinctiveness, weightedTopicScore } from '../src/lib/topic-scoring';
import { shouldRetryError } from '../src/lib/topic-rebuild';

describe('topic pipeline operations and scoring', () => {
  it('recognizes retryable transient failures', () => {
    expect(shouldRetryError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
    expect(shouldRetryError(new Error('429 rate limit'))).toBe(true);
    expect(shouldRetryError(new Error('503 temporarily unavailable'))).toBe(true);
    expect(shouldRetryError(new Error('syntax error'))).toBe(false);
  });

  it('weights topic score by frequency, distinctiveness, and inverse YAKE score', () => {
    expect(weightedTopicScore(10, 0.5, 0.02)).toBeGreaterThan(weightedTopicScore(2, 0.5, 0.02));
    expect(weightedTopicScore(10, 1, 0.02)).toBeGreaterThan(weightedTopicScore(10, 0.1, 0.02));
    expect(weightedTopicScore(10, 0.5, 0.01)).toBeGreaterThan(weightedTopicScore(10, 0.5, 0.1));
  });

  it('PBT: distinctiveness is bounded and decreases as document frequency rises', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10_000 }),
      fc.integer({ min: 1, max: 10_000 }),
      (total, df) => {
        const clampedDf = Math.min(total, df);
        const d = corpusDistinctiveness(clampedDf, total);
        expect(d).toBeGreaterThanOrEqual(0.01);
        expect(d).toBeLessThanOrEqual(1);
        if (clampedDf < total) {
          expect(corpusDistinctiveness(clampedDf + 1, total)).toBeLessThanOrEqual(d);
        }
      }
    ));
  });
});
