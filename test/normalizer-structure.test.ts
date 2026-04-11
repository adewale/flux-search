/**
 * Tests for lead essay extraction, title cleaning, and summary quality.
 * These were shipped without tests — fixing that now.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePage, computeContentHash } from '../src/lib/normalizer';

// Realistic FLUX Review issue body structure
const FLUX_ISSUE_BODY = `
[](/)# [🌀🗞 The FLUX Review](/)

- SubscribeSign in# 🌀🗞 The FLUX Review, Ep. 198

### July 17th, 2025

[The FLUX Collective](https://substack.com/@galex)Jul 18, 20251111Share

> "We cannot master everything, taste everything, understand everything, drain every experience to its last drop."

— Thomas Merton

## 🌱🏗️ Just enough structure

An open-source project gets some attention and becomes kind of a big thing. Within weeks, contributors are stepping on each other's toes. Decisions stall because nobody knows who owns what.

This is a natural consequence of scaling. As group size increases, the number of communication channels explodes.

## 🛣️🚩 Signposts

*Clues that point to where our changing world might lead us*.

🚏🏛️ There are now crypto coins tied to stocks.

## 🔍🪢 Lens of the week

This week's lens: **loose coupling**.

### Ready for more?
`;

function makePage(markdown: string, url = 'https://read.fluxcollective.org/p/198') {
  return {
    url,
    markdown,
    metadata: {
      title: '🌀🗞 The FLUX Review, Ep. 198 - by The FLUX Collective',
      'og:title': '🌀🗞 The FLUX Review, Ep. 198',
      'article:published_time': '2025-07-17T10:00:00Z',
    },
  };
}

// ========================
// Title cleaning
// ========================
describe('title cleaning at ingestion', () => {
  it('uses lead essay heading instead of Substack template title', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_BODY), 'run-1');
    expect(result.issue.title).toBe('Just enough structure');
    expect(result.issue.title).not.toContain('FLUX Review');
    expect(result.issue.title).not.toContain('🌀');
  });

  it('strips emoji prefix from lead essay title', () => {
    const body = '## 🦉🔮 Preserving the future\n\nSome content here.\n\n## 🛣️🚩 Signposts\n\nMore.';
    const result = normalizePage(makePage(body), 'run-1');
    expect(result.issue.title).toBe('Preserving the future');
  });

  it('falls back to cleaned Substack title when no lead essay heading', () => {
    const body = 'Just a plain article with no ## headings and enough content to not be junk. ' +
      'More words here to pass the 200 character threshold for issue classification. ' +
      'And even more words to make absolutely sure.';
    const result = normalizePage(makePage(body), 'run-1');
    // Should not contain emoji or "by The FLUX Collective"
    expect(result.issue.title).not.toContain('🌀');
    expect(result.issue.title).not.toContain('by The FLUX Collective');
  });

  it('produces a usable title for issue number reference when title is just template', () => {
    const body = '# 🌀🗞 The FLUX Review, Ep. 42\n\nContent. ' + 'More. '.repeat(50);
    const page = makePage(body, 'https://read.fluxcollective.org/p/42');
    page.metadata.title = '🌀🗞 The FLUX Review, Ep. 42 - by The FLUX Collective';
    page.metadata['og:title'] = '🌀🗞 The FLUX Review, Ep. 42';
    const result = normalizePage(page, 'run-1');
    expect(result.issue.title).toContain('42');
  });
});

// ========================
// Lead essay extraction
// ========================
describe('lead essay extraction', () => {
  it('extracts lead essay title from first ## heading', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_BODY), 'run-1');
    expect(result.issue.lead_essay_title).toBe('Just enough structure');
  });

  it('extracts opening quote', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_BODY), 'run-1');
    expect(result.issue.opening_quote).toContain('cannot master everything');
    expect(result.issue.opening_quote).not.toMatch(/^>/);
    expect(result.issue.opening_quote).not.toMatch(/^"/);
  });

  it('extracts lead essay body as summary', () => {
    const result = normalizePage(makePage(FLUX_ISSUE_BODY), 'run-1');
    expect(result.issue.summary).toContain('open-source project');
    expect(result.issue.summary).toContain('scaling');
    // Should not contain content from Signposts section
    expect(result.issue.summary).not.toContain('crypto coins');
  });

  it('returns null for lead essay title when no ## heading', () => {
    const body = '# Just a title\n\nSome body text here. ' + 'More. '.repeat(50);
    const result = normalizePage(makePage(body), 'run-1');
    expect(result.issue.lead_essay_title).toBeNull();
  });

  it('returns null for opening quote when none present', () => {
    const body = '## Direct start\n\nNo quote here, straight to the essay. ' + 'More. '.repeat(50);
    const result = normalizePage(makePage(body), 'run-1');
    expect(result.issue.opening_quote).toBeNull();
  });
});

// ========================
// Summary quality (isMetadataLine filtering)
// ========================
describe('summary quality', () => {
  it('skips Substack byline/date lines', () => {
    const body = '## Topic\n\nJan 15, 2024\n\nSubscribe\n\nThe real content starts here with substance.';
    const result = normalizePage(makePage(body), 'run-1');
    if (result.issue.summary) {
      expect(result.issue.summary).not.toMatch(/^Jan \d/);
      expect(result.issue.summary).not.toMatch(/^Subscribe/);
    }
  });

  it('skips share/like metadata', () => {
    const body = '## Topic\n\n42Share\n\nShare this post\n\nActual meaningful content about the topic.';
    const result = normalizePage(makePage(body), 'run-1');
    if (result.issue.summary) {
      expect(result.issue.summary).not.toContain('Share');
    }
  });
});

// ========================
// Property-based tests for structure extraction
// ========================
describe('structure extraction properties', () => {
  it('lead_essay_title never contains leading emoji', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (topic) => {
        const body = `## 🎯🌍 ${topic}\n\nSome essay content. ` + 'More. '.repeat(50);
        const result = normalizePage(makePage(body), 'run-1');
        if (result.issue.lead_essay_title) {
          // Check for supplementary emoji (U+1F000+), not ASCII digits/symbols which Unicode classifies as emoji
          expect(result.issue.lead_essay_title).not.toMatch(/^[\u{1F000}-\u{1FFFF}]/u);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('opening_quote never starts with > or bare quote marks', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 5, maxLength: 100 }), (quoteText) => {
        const body = `> "${quoteText}"\n\n## Topic\n\nContent. ` + 'More. '.repeat(50);
        const result = normalizePage(makePage(body), 'run-1');
        if (result.issue.opening_quote) {
          expect(result.issue.opening_quote).not.toMatch(/^>/);
          expect(result.issue.opening_quote).not.toMatch(/^"/);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('title never contains "by The FLUX Collective"', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const page = makePage(
          markdown.length > 200 ? markdown : markdown + ' filler '.repeat(50),
        );
        const result = normalizePage(page, 'run-1');
        expect(result.issue.title).not.toContain('by The FLUX Collective');
      }),
      { numRuns: 100 }
    );
  });

  it('summary is never just a date or byline', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 2020, max: 2026 }),
        (month, day, year) => {
          const body = `## Topic\n\n${month} ${day}, ${year}\n\n42Share\n\nReal content starts here with meaning.`;
          const result = normalizePage(makePage(body), 'run-1');
          if (result.issue.summary) {
            expect(result.issue.summary).not.toMatch(/^\w{3}\s+\d/);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});
