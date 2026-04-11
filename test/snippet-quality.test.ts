/**
 * Tests that full_text_plain (FTS-indexed column) does NOT contain:
 * - Opening blockquote text (already extracted into opening_quote)
 * - Attribution lines (— Author Name)
 * - Section heading emoji
 *
 * These leak into FTS snippets and degrade search result quality.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePage } from '../src/lib/normalizer';

// Realistic FLUX Review issue with opening quote, attribution, and emoji headings
const FLUX_ISSUE_WITH_QUOTE = `
# 🌀🗞 The FLUX Review, Ep. 82

### January 10th, 2023

> "We must not cease from exploration and the end of all our exploring will be to arrive where we began and to know the place for the first time"

— T.S. Eliot

## 🤝🔁 A model of trust

Trust and autonomy go hand in hand. When teams operate with high trust, they can move faster and make better decisions locally.

But something ere the end, some work of noble note, may yet be done.

## 🛣️🚩 Signposts

*Clues that point to where our changing world might lead us*.

🚏🏛️ A new study examines distributed systems patterns.

## 🔍🪢 Lens of the week

This week's lens: **feedback loops**.
`;

// Issue with curly quotes in blockquote
const ISSUE_WITH_CURLY_QUOTES = `
# 🌀🗞 The FLUX Review, Ep. 198

> \u201CWe cannot master everything, taste everything, understand everything, drain every experience to its last drop.\u201D

\u2014 Thomas Merton

## 🌱🏗️ Just enough structure

An open-source project gets some attention and becomes kind of a big thing.

## 🛣️🚩 Signposts

More content here about technology trends and patterns.
`;

function makePage(markdown: string, url = 'https://read.fluxcollective.org/p/82') {
  return {
    url,
    markdown,
    metadata: {
      title: '🌀🗞 The FLUX Review, Ep. 82 - by The FLUX Collective',
      'og:title': '🌀🗞 The FLUX Review, Ep. 82',
      'article:published_time': '2023-01-10T10:00:00Z',
    },
  };
}

// ========================
// Opening quote text should NOT appear in full_text_plain
// ========================
describe('full_text_plain excludes opening quote text', () => {
  it('does not contain the opening quote with straight quotes', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('We must not cease from exploration');
  });

  it('does not contain the opening quote with curly quotes', () => {
    const result = normalizePage(
      makePage(ISSUE_WITH_CURLY_QUOTES, 'https://read.fluxcollective.org/p/198'),
      'run-1',
    );
    expect(result.issue.full_text_plain).not.toContain('We cannot master everything');
  });

  it('still extracts the opening quote into opening_quote field', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.opening_quote).toContain('cease from exploration');
  });
});

// ========================
// Attribution lines should NOT appear in full_text_plain
// ========================
describe('full_text_plain excludes attribution lines', () => {
  it('does not contain em-dash attribution (— Author)', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('T.S. Eliot');
  });

  it('does not contain horizontal bar attribution (― Author)', () => {
    const markdown = FLUX_ISSUE_WITH_QUOTE.replace('— T.S. Eliot', '― T.S. Eliot');
    const result = normalizePage(makePage(markdown), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('T.S. Eliot');
  });

  it('does not contain unicode em-dash attribution (\\u2014 Author)', () => {
    const result = normalizePage(
      makePage(ISSUE_WITH_CURLY_QUOTES, 'https://read.fluxcollective.org/p/198'),
      'run-1',
    );
    expect(result.issue.full_text_plain).not.toContain('Thomas Merton');
  });
});

// ========================
// Section heading emoji should NOT appear in full_text_plain
// ========================
describe('full_text_plain excludes section heading emoji', () => {
  it('does not contain 🤝🔁 from section heading', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('🤝');
    expect(result.issue.full_text_plain).not.toContain('🔁');
  });

  it('does not contain 🛣️🚩 from section heading', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('🚩');
  });

  it('does not contain 🌱🏗️ from section heading', () => {
    const result = normalizePage(
      makePage(ISSUE_WITH_CURLY_QUOTES, 'https://read.fluxcollective.org/p/198'),
      'run-1',
    );
    expect(result.issue.full_text_plain).not.toContain('🌱');
  });

  it('preserves the heading text itself (without emoji)', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).toContain('A model of trust');
  });

  it('does not contain signpost emoji in plain text', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_WITH_QUOTE), 'run-1');
    expect(result.issue.full_text_plain).not.toContain('🚏');
  });
});

// ========================
// PBT: for any markdown with a > "quote" block, full_text_plain should not contain the quote
// ========================
describe('PBT: blockquote exclusion from full_text_plain', () => {
  it('full_text_plain never contains blockquoted text', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z .,]{5,80}$/),
        (quoteText) => {
          const markdown = [
            '# The FLUX Review, Ep. 99',
            '',
            `> "${quoteText}"`,
            '',
            '— Some Author',
            '',
            '## Section title',
            '',
            'Real content that should appear in the index. ' + 'More words. '.repeat(30),
          ].join('\n');
          const result = normalizePage(
            makePage(markdown, 'https://read.fluxcollective.org/p/99'),
            'run-1',
          );
          expect(result.issue.full_text_plain).not.toContain(quoteText);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('full_text_plain never contains attribution author name', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-z]+ [A-Z][a-z]+$/),
        (authorName) => {
          const markdown = [
            '# The FLUX Review, Ep. 99',
            '',
            '> "Some wisdom here"',
            '',
            `— ${authorName}`,
            '',
            '## Section title',
            '',
            'Real content that should appear in the index. ' + 'More words. '.repeat(30),
          ].join('\n');
          const result = normalizePage(
            makePage(markdown, 'https://read.fluxcollective.org/p/99'),
            'run-1',
          );
          expect(result.issue.full_text_plain).not.toContain(authorName);
        },
      ),
      { numRuns: 50 },
    );
  });
});
