import { describe, it, expect } from 'vitest';
import { extractAutocompleteWords } from '../src/db/queries';

describe('extractAutocompleteWords', () => {
  it('does not include URLs in extracted words', () => {
    const words = extractAutocompleteWords(
      ['Enjoy the [gumbo](https://en.wikipedia.org/wiki/Gumbo)'],
      'gum'
    );
    expect(words).toContain('gumbo');
    expect(words).not.toContain('gumbohttpsenwikipediaorgwikigumbo');
    // No word should contain 'http'
    for (const w of words) {
      expect(w).not.toContain('http');
    }
  });

  it('extracts plain words from text with markdown links', () => {
    const words = extractAutocompleteWords(
      ['The [institutional](https://example.com) trust framework'],
      'inst'
    );
    expect(words).toContain('institutional');
  });

  it('returns words matching the prefix', () => {
    const words = extractAutocompleteWords(
      ['The decision treadmill', 'Decisions under uncertainty'],
      'deci'
    );
    expect(words).toContain('decision');
    expect(words).toContain('decisions');
  });

  it('returns empty for short prefix', () => {
    const words = extractAutocompleteWords(['Hello world'], 'h');
    expect(words).toHaveLength(0);
  });
});
