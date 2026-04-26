import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cosine, jaccard, buildTopicSimilarities } from '../src/lib/topic-similarity';

describe('cosine', () => {
  it('1 for identical vectors', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it('0 for orthogonal vectors', () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('-1 for opposite vectors', () => {
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
  });

  it('0 when either input is empty or zero-norm', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0, 0], [1, 1, 1])).toBe(0);
  });

  it('PBT: result is in [-1, 1] for any equal-length vectors', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -10, max: 10, noNaN: true }), { minLength: 1, maxLength: 8 })
          .chain(a => fc.tuple(fc.constant(a), fc.array(
            fc.double({ min: -10, max: 10, noNaN: true }),
            { minLength: a.length, maxLength: a.length },
          ))),
        ([a, b]) => {
          const c = cosine(a, b);
          expect(c).toBeGreaterThanOrEqual(-1.0001);
          expect(c).toBeLessThanOrEqual(1.0001);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('jaccard', () => {
  it('1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('handles partial overlap', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])))
      .toBeCloseTo(2 / 4, 6);
  });

  it('0 for either empty input', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('buildTopicSimilarities', () => {
  const embeddings = [
    { keyword: 'governance',          vector: [1, 0, 0, 0] },
    { keyword: 'institutional trust', vector: [0.95, 0.31, 0, 0] }, // very close to governance
    { keyword: 'crypto',              vector: [0, 0, 1, 0] },
  ];
  const issueSets = new Map<string, Set<string>>([
    ['governance', new Set(['i1', 'i2'])],
    ['institutional trust', new Set(['i1', 'i2', 'i3'])],
    ['crypto', new Set(['i4'])],
  ]);

  it('emits both directions of each kept pair', () => {
    const pairs = buildTopicSimilarities(embeddings, issueSets);
    const keys = pairs.map(p => p.keyword_a + '→' + p.keyword_b).sort();
    expect(keys).toContain('governance→institutional trust');
    expect(keys).toContain('institutional trust→governance');
  });

  it('drops pairs below the blended threshold', () => {
    const pairs = buildTopicSimilarities(embeddings, issueSets, {
      alpha: 0.6, minBlended: 0.5,
    });
    expect(pairs.find(p => p.keyword_a === 'crypto')).toBeUndefined();
  });

  it('respects the alpha blend', () => {
    const onlyCosine = buildTopicSimilarities(embeddings, issueSets, { alpha: 1, minBlended: 0 });
    const govPair = onlyCosine.find(
      p => p.keyword_a === 'governance' && p.keyword_b === 'institutional trust',
    )!;
    expect(govPair.blended).toBeCloseTo(govPair.cosine, 6);
  });
});
