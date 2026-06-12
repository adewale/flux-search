/**
 * RED tests for section-aware search.
 *
 * 1. Section parsing: normalizer identifies named sections
 * 2. Section-level chunks: chunker tags chunks with section type
 * 3. Section filtering: query parser handles section: operator
 * 4. Faceted results: ranker counts results by section type
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseSections, SECTION_TYPES, type ParsedSection } from '../src/lib/sections';
import { chunkIssue } from '../src/lib/chunker';
import { parseQuery } from '../src/lib/query-parser';
import { rankResults, computeSectionFacets } from '../src/lib/hybrid-ranker';
import { makeIssue, makeFtsResult, defaultEnv } from './helpers';

// Realistic FLUX issue body
const FLUX_BODY = `
> "We cannot master everything."

— Thomas Merton

## 🌱🏗️ Just enough structure

An open-source project gets attention. Contributors step on each other's toes.
This is a natural consequence of scaling.

## 🛣️🚩 Signposts

*Clues that point to where our changing world might lead us*.

🚏🏛️ Crypto coins tied to stocks are emerging.

🚏🐧 Linux has reached 5% desktop market share.

## 📖⏳ Worth your time

- [Why Micropayments Will Never Work](https://example.com) — good analysis
- [Gen Z and Progress](https://example.com) — generational perspective

## 🔍🪢 Lens of the week

*New ways to see the world.*

This week's lens: **loose coupling**. Wikipedia demonstrates this well.

## 🔮📬 Postcard from the future

*Year 2035.* The last human translator closed their office today.
`;

// ========================
// 1. Section parsing
// ========================
describe('parseSections', () => {
  it('identifies lead essay as the first section', () => {
    const sections = parseSections(FLUX_BODY);
    expect(sections[0].type).toBe('lead_essay');
    expect(sections[0].title).toBe('Just enough structure');
    expect(sections[0].body).toContain('open-source project');
  });

  it('identifies signposts section', () => {
    const sections = parseSections(FLUX_BODY);
    const signposts = sections.find(s => s.type === 'signposts');
    expect(signposts).toBeDefined();
    expect(signposts!.body).toContain('Crypto coins');
  });

  it('identifies worth_your_time section', () => {
    const sections = parseSections(FLUX_BODY);
    const wyt = sections.find(s => s.type === 'worth_your_time');
    expect(wyt).toBeDefined();
    expect(wyt!.body).toContain('Micropayments');
  });

  it('identifies lens section', () => {
    const sections = parseSections(FLUX_BODY);
    const lens = sections.find(s => s.type === 'lens');
    expect(lens).toBeDefined();
    expect(lens!.body).toContain('loose coupling');
  });

  it('identifies postcard section', () => {
    const sections = parseSections(FLUX_BODY);
    const postcard = sections.find(s => s.type === 'postcard');
    expect(postcard).toBeDefined();
    expect(postcard!.body).toContain('translator');
  });

  it('returns all 5 sections for a complete issue', () => {
    const sections = parseSections(FLUX_BODY);
    expect(sections).toHaveLength(5);
    const types = sections.map(s => s.type);
    expect(types).toContain('lead_essay');
    expect(types).toContain('signposts');
    expect(types).toContain('worth_your_time');
    expect(types).toContain('lens');
    expect(types).toContain('postcard');
  });

  it('handles issue with no sections (bare content)', () => {
    const sections = parseSections('Just some text without any headings.');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('other');
  });

  it('handles signposts-only issue (early FLUX issues)', () => {
    const body = '## 🛣️🚩 Signposts\n\nSome links here.\n\n## 📖⏳ Worth your time\n\nMore links.';
    const sections = parseSections(body);
    // No lead essay — first section is signposts
    expect(sections[0].type).toBe('signposts');
    expect(sections.find(s => s.type === 'lead_essay')).toBeUndefined();
  });

  it('PBT: section type is always a known type', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (body) => {
        const sections = parseSections(body);
        for (const s of sections) {
          expect(SECTION_TYPES).toContain(s.type);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('PBT: every section has non-empty type and defined body', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (body) => {
        const sections = parseSections(body);
        for (const s of sections) {
          expect(s.type.length).toBeGreaterThan(0);
          expect(s.body).toBeDefined();
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ========================
// 2. Section-level chunks
// ========================
describe('section-tagged chunks', () => {
  it('chunks carry section_type from parsed sections', () => {
    const chunks = chunkIssue('id', 'Title', null, FLUX_BODY);
    // At least some chunks should have section types beyond the default
    const types = new Set(chunks.map(c => c.section_label));
    expect(types.size).toBeGreaterThan(1);
  });
});

// ========================
// 3. Section filtering
// ========================
describe('section: operator parsing', () => {
  it('parses section:signposts', () => {
    const result = parseQuery('coordination section:signposts');
    expect(result.filters.section).toBe('signposts');
    expect(result.freeText).toBe('coordination');
  });

  it('parses section:lead_essay', () => {
    const result = parseQuery('trust section:lead_essay');
    expect(result.filters.section).toBe('lead_essay');
  });

  it('parses section:lens', () => {
    const result = parseQuery('section:lens mental models');
    expect(result.filters.section).toBe('lens');
    expect(result.freeText).toBe('mental models');
  });

  it('leaves unknown section values as free text', () => {
    const result = parseQuery('section:unknown_thing trust');
    // Unknown section values should be left in free text like unknown operators
    expect(result.filters.section).toBeUndefined();
  });
});

// ========================
// 4. Faceted results
// ========================
describe('computeSectionFacets', () => {
  it('counts results by section type from snippet source', () => {
    const results = [
      { ...makeRankedResult({ section: 'lead_essay' }) },
      { ...makeRankedResult({ section: 'lead_essay' }) },
      { ...makeRankedResult({ section: 'signposts' }) },
      { ...makeRankedResult({ section: 'lens' }) },
    ];

    const facets = computeSectionFacets(results);
    expect(facets).toEqual({ lead_essay: 2, signposts: 1, lens: 1 });
  });

  it('returns empty object for no results', () => {
    expect(computeSectionFacets([])).toEqual({});
  });
});

// Helper to create minimal RankedResult-like objects for facet testing
function makeRankedResult(opts: { section?: string }) {
  return {
    issue: makeIssue(),
    snippet: 'test',
    matchedBy: ['fts'],
    confidence: 'medium' as const,
    snippetSection: opts.section || null,
    debugMeta: {
      matched_by: ['fts'], lexical_rank: 1, semantic_rank: null,
      top_chunk_section: opts.section || null,
      applied_boosts: [], applied_penalties: [], final_score: 0.5,
    },
  };
}

// ========================
// 5. Lead essay uniqueness
// ========================
// The module contract (sections.ts docstring, CLAUDE.md): "The lead essay is
// always the FIRST ## heading that doesn't match a known recurring section
// pattern." Headings after it that match nothing are one-off sections, not
// additional lead essays — they must classify as 'other'.
describe('lead essay heading uniqueness', () => {
  it('classifies only the first unknown heading as lead_essay', () => {
    const md = [
      '## The map is not the territory', // unknown → lead essay
      '',
      'Lead essay body text.',
      '',
      '## 🛣️🚩 Signposts',
      '',
      'A signpost item.',
      '',
      '## A one-off mid-issue heading', // unknown, but lead essay already found
      '',
      'One-off body.',
    ].join('\n');

    const types = parseSections(md).map(s => s.type);
    expect(types).toEqual(['lead_essay', 'signposts', 'other']);
  });

  it('still classifies recurring sections after a one-off heading', () => {
    const md = [
      '## Opening thesis',
      '',
      'Body.',
      '',
      '## Interlude', // one-off
      '',
      'Interlude body.',
      '',
      '## 📖 A book for your shelf',
      '',
      'Book blurb.',
    ].join('\n');

    const sections = parseSections(md);
    expect(sections.map(s => s.type)).toEqual(['lead_essay', 'other', 'book']);
    expect(sections[1].title).toBe('Interlude');
  });

  it('PBT: at most one heading-derived section is the lead essay', () => {
    // Titles from a constrained alphabet so they can never match a known
    // recurring-section pattern (those all require alphabetic keywords).
    const unknownTitle = fc.stringMatching(/^[0-9x]{1,12}$/);
    fc.assert(
      fc.property(
        fc.array(unknownTitle, { minLength: 2, maxLength: 6 }),
        (titles) => {
          const md = titles.map(t => `## ${t}\n\nBody for ${t}.`).join('\n\n');
          const types = parseSections(md).map(s => s.type);
          expect(types[0]).toBe('lead_essay');
          expect(types.filter(t => t === 'lead_essay')).toHaveLength(1);
          expect(types.slice(1).every(t => t === 'other')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
