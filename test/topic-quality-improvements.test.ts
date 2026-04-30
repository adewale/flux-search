import { describe, expect, it } from 'vitest';
import { classifyTopicQuality } from '../src/lib/topic-quality';
import { weightedTopicScore } from '../src/lib/topic-scoring';

describe('topic quality improvements', () => {
  it('suppresses text and HTML artifacts that must never be topics', () => {
    for (const keyword of ['img src', 'src href', 'href img', 'alt text', 'xers highlighting', 'fluxers highlighting']) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: keyword.split(' ').length,
        occurrences: 10,
        sentenceSpread: 5,
      })).toEqual({ suppress: true, reason: 'markup_artifact' });
    }
  });

  it('suppresses malformed fragments from the current topic audit', () => {
    for (const keyword of [
      'secretary of defense rock',
      'exchange commission',
      'many americans',
      'top-right quadrant',
      'labor day',
      'golden state',
      'world war',
      'le guin',
      'packy mc',
      'native american',
      'technology review',
      'census bureau',
      'air force',
    ]) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: keyword.split(' ').length,
        occurrences: 10,
        sentenceSpread: 5,
      })).toEqual({ suppress: true, reason: 'malformed_phrase' });
    }
  });

  it('does not suppress protected publication names, short topics, or full book titles', () => {
    for (const keyword of ['crypto', 'rest of world', 'not boring', 'crooked timber', 'simple habits for complex times']) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: keyword.split(' ').length,
        occurrences: 3,
        sentenceSpread: 3,
      })).toEqual({ suppress: false, reason: null });
    }
  });

  it('suppresses malformed clause fragments from issue-level extraction', () => {
    for (const keyword of ['as treasury', 'good reason you can', 'biggest film bombed']) {
      expect(classifyTopicQuality({
        keyword,
        keyword_display: keyword,
        score: 0.01,
        rank: 1,
        ngram_size: keyword.split(' ').length,
        occurrences: 2,
        sentenceSpread: 2,
      })).toEqual({ suppress: true, reason: 'malformed_phrase' });
    }
  });

  it('suppresses incomplete n-gram fragments with weak trailing words', () => {
    expect(classifyTopicQuality({
      keyword: 'seeing like',
      keyword_display: 'seeing like',
      score: 0.01,
      rank: 1,
      ngram_size: 2,
      occurrences: 8,
      sentenceSpread: 5,
    })).toEqual({ suppress: true, reason: 'weak_phrase' });
  });

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
