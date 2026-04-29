import { describe, expect, it } from 'vitest';
import { classifyTopicQuality } from '../src/lib/topic-quality';
import { weightedTopicScore } from '../src/lib/topic-scoring';

describe('topic quality improvements', () => {
  it('suppresses editorial boilerplate phrases that must never be topics', () => {
    for (const keyword of ['signposts clues', 'editor note']) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: keyword.split(' ').length,
        occurrences: 5,
        sentenceSpread: 3,
      })).toEqual({ suppress: true, reason: 'boilerplate_phrase' });
    }
  });

  it('suppresses generic singleton navigation noise', () => {
    for (const keyword of ['people', 'world', 'time', 'move', 'point', 'direction']) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: 1,
        occurrences: 100,
        sentenceSpread: 50,
      }).suppress).toBe(true);
    }
  });

  it('prefers meaningful multi-word phrases over equally frequent singletons', () => {
    const phrase = weightedTopicScore(10, 0.5, 0.02, { ngramSize: 2, provenanceCount: 2 });
    const singleton = weightedTopicScore(10, 0.5, 0.02, { ngramSize: 1, provenanceCount: 1 });
    expect(phrase).toBeGreaterThan(singleton);
  });
});
