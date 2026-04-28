import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseQuery } from '../src/lib/query-parser';

describe('topic: operator', () => {
  it('parses single-word topic', () => {
    const result = parseQuery('topic:trust');
    expect(result.filters.topic).toBe('trust');
    expect(result.freeText).toBe('');
  });

  it('parses quoted multi-word topic', () => {
    const result = parseQuery('topic:"institutional trust"');
    expect(result.filters.topic).toBe('institutional trust');
    expect(result.freeText).toBe('');
    expect(result.phrases).toEqual([]);
  });

  it('lowercases the topic value', () => {
    const result = parseQuery('topic:"Institutional Trust"');
    expect(result.filters.topic).toBe('institutional trust');
  });

  it('coexists with free text', () => {
    const result = parseQuery('governance topic:"institutional trust"');
    expect(result.filters.topic).toBe('institutional trust');
    expect(result.freeText).toBe('governance');
  });

  it('coexists with other operators', () => {
    const result = parseQuery('topic:trust year:2024 section:lead_essay');
    expect(result.filters.topic).toBe('trust');
    expect(result.filters.year).toBe(2024);
    expect(result.filters.section).toBe('lead_essay');
  });

  it('keeps quoted non-topic phrases as phrases', () => {
    const result = parseQuery('"exact phrase" topic:trust');
    expect(result.filters.topic).toBe('trust');
    expect(result.phrases).toEqual(['exact phrase']);
  });

  it('does not confuse topic: with phrases when mixed', () => {
    const result = parseQuery('"some quote" topic:"institutional trust"');
    expect(result.filters.topic).toBe('institutional trust');
    expect(result.phrases).toEqual(['some quote']);
  });

  it('collapses internal whitespace in the topic value', () => {
    const result = parseQuery('topic:"institutional    trust"');
    expect(result.filters.topic).toBe('institutional trust');
  });

  // Sad paths
  it('handles empty quoted topic gracefully', () => {
    const result = parseQuery('topic:""');
    expect(result.filters.topic).toBeUndefined();
  });

  it('handles unclosed quote — falls through to phrases/free text', () => {
    const result = parseQuery('topic:"institutional');
    expect(result.filters.topic).toBeUndefined();
  });

  it('does not throw on adversarial input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const input = `topic:"${s}"`;
        expect(() => parseQuery(input)).not.toThrow();
      }),
      { numRuns: 200 }
    );
  });

  it('is included in operators array for display', () => {
    const result = parseQuery('topic:"civic repair"');
    expect(result.operators.some(op => op.toLowerCase().startsWith('topic:'))).toBe(true);
  });
});
