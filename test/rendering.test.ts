/**
 * Tests for rendering fixes:
 * 1. Substack image URLs stripped from markdown and plain text
 * 2. detectSnippetSection matches FTS snippet to section type
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePage } from '../src/lib/normalizer';
import { parseSections } from '../src/lib/sections';
import { detectSnippetSection } from '../src/lib/hybrid-ranker';

describe('Substack image URL cleanup', () => {
  it('strips [](substackcdn...) from markdown', () => {
    const md = '## Title\n\nReal content.\n\n[](https://substackcdn.com/image/fetch/something.png)\n\nMore.';
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: md,
      metadata: {},
    }, 'run-1');
    expect(result.issue.full_text_markdown).not.toContain('substackcdn');
    expect(result.issue.full_text_plain).not.toContain('substackcdn');
    expect(result.issue.full_text_plain).not.toContain('[](');
  });

  it('strips [](substackcdn...) from section bodies', () => {
    const md = '## Signposts\n\nA signpost.\n\n[](https://substackcdn.com/image/fetch/$s_!1J1H!,f.png)\n\nAnother.';
    // parseSections runs on cleanMarkdown, which should have stripped the image
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: md,
      metadata: {},
    }, 'run-1');
    const sections = parseSections(result.issue.full_text_markdown || '');
    for (const s of sections) {
      expect(s.body).not.toContain('substackcdn');
    }
  });

  it('preserves real image alt text links', () => {
    const md = '## Title\n\n[Click here](https://example.com)\n\nContent. ' + 'More. '.repeat(30);
    const result = normalizePage({
      url: 'https://example.com/p/test',
      markdown: md,
      metadata: {},
    }, 'run-1');
    // Real links with text should be preserved in markdown
    expect(result.issue.full_text_markdown).toContain('[Click here]');
  });

  it('PBT: plain text never contains [](http after cleanup', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
        const md = '## T\n\n' + text + '\n\n[](https://substackcdn.com/x.png)\n\n' + text;
        const result = normalizePage({
          url: 'https://example.com/p/test',
          markdown: md,
          metadata: {},
        }, 'run-1');
        if (result.issue.full_text_plain) {
          expect(result.issue.full_text_plain).not.toContain('[](http');
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe('detectSnippetSection', () => {
  const sections = [
    { type: 'lead_essay', body: 'Trust grows incrementally when risk is highly asymmetric between parties.' },
    { type: 'signposts', body: 'Crypto coins tied to stocks are emerging in Asian markets.' },
    { type: 'lens', body: 'This week we examine loose coupling as an organizational principle.' },
  ];

  it('identifies lead_essay from snippet content', () => {
    expect(detectSnippetSection('Trust grows incrementally when risk', sections)).toBe('lead_essay');
  });

  it('identifies signposts from snippet content', () => {
    expect(detectSnippetSection('Crypto coins tied to stocks are', sections)).toBe('signposts');
  });

  it('identifies section even with <mark> tags', () => {
    expect(detectSnippetSection('...<mark>Trust</mark> grows incrementally when...', sections)).toBe('lead_essay');
  });

  it('returns null when snippet matches no section', () => {
    expect(detectSnippetSection('completely unrelated text here', sections)).toBeNull();
  });

  it('returns null for empty/short snippet', () => {
    expect(detectSnippetSection('', sections)).toBeNull();
    expect(detectSnippetSection('hi', sections)).toBeNull();
  });
});
