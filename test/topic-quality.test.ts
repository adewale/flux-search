/**
 * Topic-quality heuristics.
 *
 * Adapted to Flux's per-issue extractor. Each rule has a corresponding
 * suppression reason so the pipeline stays
 * auditable.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifyTopicQuality,
  filterTopics,
  PROTECTED_TOPICS,
  NOISE_WORDS,
} from '../src/lib/topic-quality';

function topic(over: Partial<any> = {}): any {
  return {
    keyword: 'governance', keyword_display: 'governance',
    score: 0.1, rank: 1, ngram_size: 1, occurrences: 5,
    sentenceSpread: 3,
    ...over,
  };
}

describe('classifyTopicQuality', () => {
  describe('hard rejections', () => {
    it('drops noise words', () => {
      const v = classifyTopicQuality(topic({ keyword: 'leverage' }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('noise_word');
    });

    it('drops short single-word topics with low occurrences', () => {
      const v = classifyTopicQuality(topic({ keyword: 'foo', ngram_size: 1, occurrences: 3 }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('short_low_freq');
    });

    it('keeps short single-word topics if occurrences are very high', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'foo', ngram_size: 1, occurrences: 25, sentenceSpread: 8,
      }));
      expect(v.suppress).toBe(false);
    });

    it('drops phrases starting with pronoun-like fillers', () => {
      const v = classifyTopicQuality(topic({ keyword: 'someone else', ngram_size: 2 }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('pronoun_lead');
    });
  });

  describe('protected topics override generic rules', () => {
    it('keeps protected topics regardless of length / occurrences', () => {
      for (const protectedKw of PROTECTED_TOPICS) {
        const v = classifyTopicQuality(topic({
          keyword: protectedKw, ngram_size: 1, occurrences: 1,
        }));
        expect(v.suppress).toBe(false);
      }
    });
  });

  describe('suffix detection', () => {
    it('penalizes single-word -ly adverbs as weak singletons', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'rapidly', ngram_size: 1, occurrences: 5, sentenceSpread: 1,
      }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('weak_suffix');
    });

    it('penalizes -ize verbs as weak singletons', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'realize', ngram_size: 1, occurrences: 4, sentenceSpread: 1,
      }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('weak_suffix');
    });

    it('keeps -ment singles when usage is high enough', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'experiment', ngram_size: 1, occurrences: 30, sentenceSpread: 8,
      }));
      expect(v.suppress).toBe(false);
    });
  });

  describe('weak singleton detection', () => {
    it('drops singles with low occurrences and low spread', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'distributed', ngram_size: 1, occurrences: 2, sentenceSpread: 1,
      }));
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('weak_singleton');
    });

    it('keeps singles with strong spread even at modest occurrences', () => {
      const v = classifyTopicQuality(topic({
        keyword: 'distributed', ngram_size: 1, occurrences: 4, sentenceSpread: 4,
      }));
      expect(v.suppress).toBe(false);
    });
  });

  describe('blocklist', () => {
    it('drops keywords in the issue blocklist', () => {
      const v = classifyTopicQuality(topic({ keyword: 'flux' }), { blocklist: new Set(['flux']) });
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('blocklist');
    });
  });

  describe('phrase-component suppression', () => {
    it('suppresses single words that are dominated by an established phrase', () => {
      // "trust" appears in 5 single-word slots, but "institutional trust"
      // accounts for 4 of those occurrences (>= 25%).
      const v = classifyTopicQuality(
        topic({ keyword: 'trust', ngram_size: 1, occurrences: 5, sentenceSpread: 4 }),
        {
          phraseComponentRatios: new Map([['trust', 0.8]]),
        },
      );
      expect(v.suppress).toBe(true);
      expect(v.reason).toBe('phrase_component');
    });

    it('keeps words with low phrase-dominance', () => {
      const v = classifyTopicQuality(
        topic({ keyword: 'trust', ngram_size: 1, occurrences: 5, sentenceSpread: 4 }),
        {
          phraseComponentRatios: new Map([['trust', 0.10]]),
        },
      );
      expect(v.suppress).toBe(false);
    });
  });
});

describe('filterTopics', () => {
  it('returns the kept topics with re-ranked positions and the suppressed ones', () => {
    const input = [
      topic({ keyword: 'governance',  rank: 1 }),
      topic({ keyword: 'leverage',    rank: 2 }),
      topic({ keyword: 'institutional trust', rank: 3, ngram_size: 2 }),
    ];
    const out = filterTopics(input);

    expect(out.kept.map(t => t.keyword)).toEqual([
      'governance', 'institutional trust',
    ]);
    expect(out.kept[0].rank).toBe(1);
    expect(out.kept[1].rank).toBe(2);
    expect(out.suppressed.length).toBe(1);
    expect(out.suppressed[0].keyword).toBe('leverage');
    expect(out.suppressed[0].suppression_reason).toBe('noise_word');
  });

  it('PBT: never throws on adversarial unicode keywords', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 20 }),
        (keywords) => {
          const arr = keywords.map((k, i) => topic({ keyword: k, keyword_display: k, rank: i + 1 }));
          expect(() => filterTopics(arr)).not.toThrow();
        }),
      { numRuns: 200 },
    );
  });
});

describe('NOISE_WORDS', () => {
  it('contains the canonical cross-domain fillers', () => {
    for (const w of ['leverage', 'enable', 'utilise', 'utilize', 'system', 'data']) {
      expect(NOISE_WORDS.has(w)).toBe(true);
    }
  });
});
