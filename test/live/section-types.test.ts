/**
 * The ChunkLabel / DisplaySection boundary, checked against a deployed
 * Worker (real Vectorize metadata). test/section-types.test.ts covers the
 * same response invariants offline with a Vectorize double.
 */
import { describe, it, expect } from 'vitest';
import { DISPLAY_SECTIONS, type DisplaySection } from '../../src/lib/sections';
import { SEARCH_URL } from './live-url';

describe('live API: no chunk labels in responses', () => {
  // Four sequential round trips to the deployed Worker; the vitest default
  // 5s timeout flaked in CI when broad queries ran slow. Generous explicit
  // timeouts keep the live checks without the flake.
  it('search results never have title_summary as snippet_section', async () => {
    // title_summary is the most likely leak — it's the first chunk's label
    const queries = ['systems', 'the', 'trust', 'crypto'];
    for (const q of queries) {
      const resp = await fetch(`${SEARCH_URL}/search?q=${q}&limit=20`);
      const data = await resp.json() as any;
      for (const r of data.results) {
        expect(r.snippet_section,
          `#${r.issue_number} has chunk label "${r.snippet_section}" instead of display section`
        ).not.toBe('title_summary');
      }
    }
  }, 30000);

  it('section_facets keys are all display sections', async () => {
    const resp = await fetch(`${SEARCH_URL}/search?q=trust&limit=20`);
    const data = await resp.json() as any;
    const validSections = new Set(DISPLAY_SECTIONS);
    for (const key of Object.keys(data.section_facets)) {
      expect(validSections.has(key as DisplaySection),
        `facet key "${key}" is not a display section`
      ).toBe(true);
    }
  }, 15000);
});
