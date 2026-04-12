/**
 * Tests for detectSnippetSection — the function that maps FTS highlight
 * snippets back to the newsletter section they came from.
 *
 * These tests use real snippet patterns observed from production search
 * results where ~74% of results had null snippet_section.
 *
 * Root causes of failures:
 * 1. Snippets starting with "..." ellipsis prefix (FTS context marker)
 * 2. Snippets containing <mark> tags around matched terms
 * 3. Snippets starting with section heading text ("Book for your shelf")
 *    which appears in the title, not the body
 * 4. Snippets starting with metadata (dates, photo credits)
 * 5. Snippets too short after cleaning
 * 6. Snippets with text split across "..." ellipsis boundaries
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { detectSnippetSection } from '../src/lib/hybrid-ranker';

// Realistic sections modeled after FLUX Review issues
const SECTIONS = [
  {
    type: 'lead_essay',
    title: 'Just enough structure',
    body: 'An open-source project gets attention. Contributors step on each other\'s toes. This is a natural consequence of scaling. Systems thinking teaches us to look at the whole.',
  },
  {
    type: 'signposts',
    title: 'Signposts',
    body: 'Clues that point to where our changing world might lead us. Crypto coins tied to stocks are emerging. Linux has reached 5% desktop market share.',
  },
  {
    type: 'book',
    title: 'Book for your shelf',
    body: 'An evergreen book that will help you dip your toes into systems thinking. This week, we recommend The Fifth Discipline by Peter Senge.',
  },
  {
    type: 'worth_your_time',
    title: 'Worth your time',
    body: 'Why Micropayments Will Never Work — good analysis. Systems Thinking Is Brain Rot for Analysts — argues that systems thinking can give junior analysts unrealistic expectations.',
  },
  {
    type: 'lens',
    title: 'Lens of the week',
    body: 'New ways to see the world. This week\'s lens: loose coupling. Wikipedia demonstrates this well.',
  },
  {
    type: 'postcard',
    title: 'Postcard from the future',
    body: 'Year 2035. The last human translator closed their office today.',
  },
];

// ========================
// 1. Basic detection from body text (existing behavior that must keep working)
// ========================
describe('detectSnippetSection: basic body matching', () => {
  it('detects lead_essay from body text', () => {
    expect(detectSnippetSection(
      'An open-source project gets attention. Contributors step',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects signposts from body text', () => {
    expect(detectSnippetSection(
      'Crypto coins tied to stocks are emerging',
      SECTIONS,
    )).toBe('signposts');
  });

  it('detects book from body text', () => {
    expect(detectSnippetSection(
      'we recommend The Fifth Discipline by Peter Senge',
      SECTIONS,
    )).toBe('book');
  });

  it('returns null for text not in any section', () => {
    expect(detectSnippetSection(
      'completely unrelated text that appears nowhere in the sections',
      SECTIONS,
    )).toBeNull();
  });

  it('returns null for empty snippet', () => {
    expect(detectSnippetSection('', SECTIONS)).toBeNull();
  });

  it('returns null for very short snippet', () => {
    expect(detectSnippetSection('hi', SECTIONS)).toBeNull();
  });
});

// ========================
// 2. FTS markup: <mark> tags and ... ellipses
// ========================
describe('detectSnippetSection: FTS markup handling', () => {
  it('detects section when snippet has <mark> tags', () => {
    expect(detectSnippetSection(
      'An open-source project gets attention. <mark>Contributors</mark> step on each other\'s toes',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section when snippet starts with <mark> tag', () => {
    expect(detectSnippetSection(
      '<mark>Systems thinking</mark> teaches us to look at the whole.',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section when snippet has leading ... ellipsis', () => {
    expect(detectSnippetSection(
      '...Contributors step on each other\'s toes. This is a natural consequence of scaling.',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section when snippet has both ... and <mark>', () => {
    expect(detectSnippetSection(
      '...<mark>Systems thinking</mark> teaches us to look at the whole.',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section when snippet has multiple ... ellipsis breaks', () => {
    expect(detectSnippetSection(
      '...open-source project gets attention...Contributors step on each other\'s toes...',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section with trailing ... ellipsis', () => {
    expect(detectSnippetSection(
      'Linux has reached 5% desktop market share...',
      SECTIONS,
    )).toBe('signposts');
  });
});

// ========================
// 3. The "Book for your shelf" heading pattern — the most common failure case
// ========================
describe('detectSnippetSection: heading text in snippets', () => {
  it('detects book section when snippet starts with heading text then body', () => {
    // This is the #1 failure pattern: snippet includes the heading "Book for your shelf"
    // followed by body text. The heading is the section TITLE, not in the body.
    expect(detectSnippetSection(
      '...Book for your shelf\nAn evergreen book that will help you dip your toes into <mark>systems thinking</mark>.\nThis week, we recommend The Fifth Discipline',
      SECTIONS,
    )).toBe('book');
  });

  it('detects book section when heading text is the only lead-in', () => {
    expect(detectSnippetSection(
      '...Book for your shelf\nAn evergreen book that will help you dip your toes into <mark>systems thinking</mark>.',
      SECTIONS,
    )).toBe('book');
  });

  it('detects book section from snippet with variant heading "Book Game for your shelf"', () => {
    // Real data: some issues use "Book Game for your shelf" instead
    const sectionsWithVariant = SECTIONS.map(s =>
      s.type === 'book'
        ? { ...s, title: 'Book Game for your shelf', body: 'A game that will help you dip your toes into systems thinking or explore its broader applications.' }
        : s
    );
    expect(detectSnippetSection(
      '...Book Game for your shelf\nA game that will help you dip your toes into <mark>systems thinking</mark> or explore its broader applications.',
      sectionsWithVariant,
    )).toBe('book');
  });

  it('detects section from title match when body text is absent from snippet', () => {
    // Snippet has ONLY the heading text and very little body
    expect(detectSnippetSection(
      '...Book for your shelf\nAn evergreen book that will help',
      SECTIONS,
    )).toBe('book');
  });

  it('detects lens section when snippet includes heading', () => {
    expect(detectSnippetSection(
      '...Lens of the week\nNew ways to see the world.',
      SECTIONS,
    )).toBe('lens');
  });
});

// ========================
// 4. Metadata-prefixed snippets (dates, credit lines)
// ========================
describe('detectSnippetSection: metadata prefix', () => {
  it('detects section when snippet starts with date then body text', () => {
    // Real pattern: "September 18th, 2025\nSep 19, [...]\n\nFLUX has been writing about..."
    // The date metadata is not in any section, but the body text after it is.
    expect(detectSnippetSection(
      'September 18th, 2025\nSep 19, [ A simple system ]\n\nSystems thinking teaches us to look at the whole.',
      SECTIONS,
    )).toBe('lead_essay');
  });

  it('detects section when snippet starts with date followed by body after newlines', () => {
    expect(detectSnippetSection(
      'June 24th, 2021\n25,\n\nContributors step on each other\'s toes. This is a natural consequence of scaling.',
      SECTIONS,
    )).toBe('lead_essay');
  });
});

// ========================
// 5. Mid-snippet matching (text from the middle, not the start)
// ========================
describe('detectSnippetSection: mid-snippet probes', () => {
  it('detects section when matching text appears only in the middle of snippet', () => {
    expect(detectSnippetSection(
      '...some unrelated preamble text here about nothing in particular. The Fifth Discipline by Peter Senge is essential reading.',
      SECTIONS,
    )).toBe('book');
  });

  it('detects section when matching text appears after ellipsis break', () => {
    expect(detectSnippetSection(
      '...shelf\nA book that will help you dip your toes into <mark>systems thinking</mark> or explore its broader applications.',
      SECTIONS,
    )).toBe('book');
  });
});

// ========================
// 6. Short snippets
// ========================
describe('detectSnippetSection: short snippets', () => {
  it('handles snippet with exactly 3 words that match', () => {
    expect(detectSnippetSection(
      'loose coupling. Wikipedia',
      SECTIONS,
    )).toBe('lens');
  });

  it('returns null for snippet with fewer than 3 words after cleaning', () => {
    expect(detectSnippetSection('...the...', SECTIONS)).toBeNull();
  });

  it('returns null for snippet of only markup', () => {
    expect(detectSnippetSection('<mark></mark>...', SECTIONS)).toBeNull();
  });
});

// ========================
// 7. Pre-heading text (lead essay body before any ## heading)
// ========================
describe('detectSnippetSection: pre-heading lead essay', () => {
  it('detects lead_essay from pre-heading text in sections with empty title', () => {
    const sectionsWithPreheading = [
      {
        type: 'lead_essay',
        title: '',
        body: 'FLUX has been writing about systems thinking for years. This is the pre-heading content.',
      },
      ...SECTIONS.slice(1),
    ];
    expect(detectSnippetSection(
      'FLUX has been writing about <mark>systems thinking</mark> for years.',
      sectionsWithPreheading,
    )).toBe('lead_essay');
  });
});

// ========================
// 8. Property-based tests
// ========================
describe('detectSnippetSection: property-based tests', () => {
  it('if snippet is a substring of a section body, detection finds that section', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SECTIONS.length - 1 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 15, max: 80 }),
        (sectionIdx, start, len) => {
          const section = SECTIONS[sectionIdx];
          const body = section.body;
          // Clamp to valid indices
          const actualStart = Math.min(start, Math.max(0, body.length - 15));
          const actualLen = Math.min(len, body.length - actualStart);
          if (actualLen < 15) return; // skip if body too short

          const substring = body.slice(actualStart, actualStart + actualLen);
          // Only test if we got at least 3 words
          const words = substring.trim().split(/\s+/).filter(w => w.length > 0);
          if (words.length < 4) return;

          const result = detectSnippetSection(substring, SECTIONS);
          // Must find the correct section (or at least find something —
          // another section might also contain this text)
          expect(result).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never crashes on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (snippet) => {
        const result = detectSnippetSection(snippet, SECTIONS);
        expect(result === null || typeof result === 'string').toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('stripping <mark> tags does not change the result', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SECTIONS.length - 1 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 15, max: 60 }),
        (sectionIdx, start, len) => {
          const section = SECTIONS[sectionIdx];
          const body = section.body;
          const actualStart = Math.min(start, Math.max(0, body.length - 15));
          const actualLen = Math.min(len, body.length - actualStart);
          if (actualLen < 15) return;

          const substring = body.slice(actualStart, actualStart + actualLen);
          const words = substring.trim().split(/\s+/).filter(w => w.length > 0);
          if (words.length < 4) return;

          // Add <mark> tags around a random word
          const markIdx = Math.floor(words.length / 2);
          const markedWords = [...words];
          markedWords[markIdx] = `<mark>${markedWords[markIdx]}</mark>`;
          const markedSnippet = markedWords.join(' ');

          const plainResult = detectSnippetSection(substring, SECTIONS);
          const markedResult = detectSnippetSection(markedSnippet, SECTIONS);
          expect(markedResult).toBe(plainResult);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('leading/trailing ellipses do not change the result', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SECTIONS.length - 1 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 15, max: 60 }),
        (sectionIdx, start, len) => {
          const section = SECTIONS[sectionIdx];
          const body = section.body;
          const actualStart = Math.min(start, Math.max(0, body.length - 15));
          const actualLen = Math.min(len, body.length - actualStart);
          if (actualLen < 15) return;

          const substring = body.slice(actualStart, actualStart + actualLen);
          const words = substring.trim().split(/\s+/).filter(w => w.length > 0);
          if (words.length < 4) return;

          const plainResult = detectSnippetSection(substring, SECTIONS);
          const ellipsisResult = detectSnippetSection('...' + substring + '...', SECTIONS);
          expect(ellipsisResult).toBe(plainResult);
        },
      ),
      { numRuns: 100 },
    );
  });
});
