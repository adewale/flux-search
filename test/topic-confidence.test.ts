import { describe, it, expect } from 'vitest';
import { classifyTopicConfidence } from '../src/lib/topic-quality';

describe('classifyTopicConfidence', () => {
  it('high when multiple strategies agree and corpus uses it widely', () => {
    expect(classifyTopicConfidence({
      provenanceCount: 3, docFrequency: 12,
    })).toBe('high');
  });

  it('medium when only one signal qualifies', () => {
    expect(classifyTopicConfidence({
      provenanceCount: 1, docFrequency: 6,
    })).toBe('medium');
    expect(classifyTopicConfidence({
      provenanceCount: 2, docFrequency: 1,
    })).toBe('medium');
  });

  it('low when both signals are weak', () => {
    expect(classifyTopicConfidence({
      provenanceCount: 1, docFrequency: 1,
    })).toBe('low');
  });

  it('drops one tier when the keyword has a suppression history', () => {
    expect(classifyTopicConfidence({
      provenanceCount: 3, docFrequency: 12, suppressionHits: 1,
    })).toBe('medium');
    expect(classifyTopicConfidence({
      provenanceCount: 1, docFrequency: 6, suppressionHits: 1,
    })).toBe('low');
  });

  it('clamps at low even with many suppression hits', () => {
    expect(classifyTopicConfidence({
      provenanceCount: 1, docFrequency: 1, suppressionHits: 99,
    })).toBe('low');
  });
});
