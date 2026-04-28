import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { stem, stemPhrase, diceSimilarity } from '../src/lib/porter-stem';

describe('stem', () => {
  it('collapses simple plurals', () => {
    expect(stem('models')).toBe('model');
    expect(stem('issues')).toBe('issue');
  });

  it('reverses -ies → y', () => {
    expect(stem('cities')).toBe('city');
    expect(stem('libraries')).toBe('library');
  });

  it('strips -ing when there is a vowel before', () => {
    expect(stem('coupling')).toBe('coupl');
    expect(stem('thinking')).toBe('think');
  });

  it('strips -ed appropriately', () => {
    expect(stem('coupled')).toBe('coupl');
    expect(stem('shipped')).toBe('ship');
  });

  it('returns short words untouched', () => {
    expect(stem('ai')).toBe('ai');
    expect(stem('the')).toBe('the');
  });

  it('PBT: never throws on arbitrary strings', () => {
    fc.assert(fc.property(fc.string({ maxLength: 30 }), s => {
      expect(() => stem(s)).not.toThrow();
    }), { numRuns: 200 });
  });
});

describe('stemPhrase', () => {
  it('stems each token', () => {
    expect(stemPhrase('mental models')).toBe('mental model');
    expect(stemPhrase('loose couplings')).toBe('loose coupl');
  });

  it('preserves word order across tokens', () => {
    // The simple rules don't strip -al; that's intentional (over-stemming
    // collapses too many distinct words). What we care about is that
    // each token is processed independently and order is preserved.
    expect(stemPhrase('issues models')).toBe('issue model');
  });
});

describe('diceSimilarity', () => {
  it('identical strings score 1', () => {
    expect(diceSimilarity('governance', 'governance')).toBe(1);
  });

  it('disjoint strings score 0', () => {
    expect(diceSimilarity('aaa', 'bbb')).toBe(0);
  });

  it('near-duplicates score above 0.6', () => {
    expect(diceSimilarity('institutional trust', 'institutional trusts'))
      .toBeGreaterThan(0.85);
  });

  it('completely different phrases score below 0.4', () => {
    expect(diceSimilarity('institutional trust', 'civic engagement'))
      .toBeLessThan(0.4);
  });

  it('PBT: result is always in [0, 1]', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }),
        (a, b) => {
          const s = diceSimilarity(a, b);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }),
      { numRuns: 200 },
    );
  });
});
