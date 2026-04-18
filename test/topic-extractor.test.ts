import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractTopics, normalizeKeyword } from '../src/lib/topic-extractor';

const SAMPLE = `
Institutional trust is collapsing. The question of legitimacy now dominates
every conversation about governance, from city councils to large language
models. When civic repair becomes a line item on a product roadmap, we
should notice. Institutional trust does not recover by accident; it recovers
through design, through friction, through the slow accumulation of kept
promises. Large language models will not fix this. They may, in fact, make
institutional trust harder to rebuild by eroding the shared factual substrate
that legitimacy depends upon.
`.repeat(3);

describe('extractTopics', () => {
  it('returns topics ordered by rank ascending starting at 1', () => {
    const topics = extractTopics(SAMPLE, { top: 10 });

    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].rank).toBe(1);
    for (let i = 1; i < topics.length; i++) {
      expect(topics[i].rank).toBe(i + 1);
    }
  });

  it('returns topics sorted by score ascending (YAKE: lower = better)', () => {
    const topics = extractTopics(SAMPLE, { top: 10 });
    for (let i = 1; i < topics.length; i++) {
      expect(topics[i].score).toBeGreaterThanOrEqual(topics[i - 1].score);
    }
  });

  it('never returns more than `top` results', () => {
    const topics = extractTopics(SAMPLE, { top: 5 });
    expect(topics.length).toBeLessThanOrEqual(5);
  });

  it('captures the dominant phrase from FLUX-style text', () => {
    const topics = extractTopics(SAMPLE, { top: 20 });
    const keywords = topics.map(t => t.keyword);

    expect(keywords).toContain('institutional trust');
  });

  it('never emits n-grams longer than n (default 3)', () => {
    const topics = extractTopics(SAMPLE, { top: 25 });
    for (const t of topics) {
      expect(t.ngram_size).toBeLessThanOrEqual(3);
      expect(t.ngram_size).toBeGreaterThanOrEqual(1);
    }
  });

  it('ngram_size matches actual word count of keyword_display', () => {
    const topics = extractTopics(SAMPLE, { top: 20 });
    for (const t of topics) {
      const words = t.keyword_display.trim().split(/\s+/).length;
      expect(t.ngram_size).toBe(words);
    }
  });

  it('keyword is lowercased', () => {
    const topics = extractTopics(SAMPLE, { top: 20 });
    for (const t of topics) {
      expect(t.keyword).toBe(t.keyword.toLowerCase());
    }
  });

  // Sad paths
  it('returns [] for empty string', () => {
    expect(extractTopics('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(extractTopics('   \n\t  ')).toEqual([]);
  });

  it('does not throw on null or undefined', () => {
    expect(() => extractTopics(null as unknown as string)).not.toThrow();
    expect(() => extractTopics(undefined as unknown as string)).not.toThrow();
    expect(extractTopics(null as unknown as string)).toEqual([]);
    expect(extractTopics(undefined as unknown as string)).toEqual([]);
  });

  it('returns [] when text contains only stopwords', () => {
    expect(extractTopics('the and of to a is it in that')).toEqual([]);
  });

  it('handles apostrophes, angle brackets, ampersands without throwing', () => {
    const text = "FLUX's take on <AI> & governance: it's a question of trust's decay.".repeat(5);
    expect(() => extractTopics(text)).not.toThrow();
    const topics = extractTopics(text);
    expect(topics.length).toBeGreaterThan(0);
  });
});

describe('extractTopics properties', () => {
  it('is deterministic — same input always produces identical output', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 20, maxLength: 2000 }), (text) => {
        const a = extractTopics(text, { top: 10 });
        const b = extractTopics(text, { top: 10 });
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });

  it('never throws on arbitrary Unicode input', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => extractTopics(text)).not.toThrow();
      }),
      { numRuns: 500 }
    );
  });

  it('result length is bounded by `top`', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 3000 }),
        fc.integer({ min: 1, max: 50 }),
        (text, top) => {
          const topics = extractTopics(text, { top });
          expect(topics.length).toBeLessThanOrEqual(top);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ranks are 1..N with no gaps', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 50, maxLength: 2000 }), (text) => {
        const topics = extractTopics(text, { top: 15 });
        for (let i = 0; i < topics.length; i++) {
          expect(topics[i].rank).toBe(i + 1);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('scores are non-decreasing (sorted by relevance)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 50, maxLength: 2000 }), (text) => {
        const topics = extractTopics(text, { top: 20 });
        for (let i = 1; i < topics.length; i++) {
          expect(topics[i].score).toBeGreaterThanOrEqual(topics[i - 1].score);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('every keyword is a substring of the normalized input text', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 100, maxLength: 3000 }), (text) => {
        const topics = extractTopics(text, { top: 10 });
        const haystack = text.toLowerCase();
        for (const t of topics) {
          expect(haystack).toContain(t.keyword.split(/\s+/)[0]);
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe('normalizeKeyword', () => {
  it('lowercases', () => {
    expect(normalizeKeyword('Institutional Trust')).toBe('institutional trust');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeKeyword('institutional    trust')).toBe('institutional trust');
    expect(normalizeKeyword('institutional\t\ntrust')).toBe('institutional trust');
  });

  it('strips outer whitespace', () => {
    expect(normalizeKeyword('  institutional trust  ')).toBe('institutional trust');
  });

  it('is idempotent — normalize(normalize(x)) === normalize(x)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeKeyword(s);
        const twice = normalizeKeyword(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 500 }
    );
  });
});
