/**
 * Tests for the ChunkLabel / DisplaySection type boundary.
 *
 * Chunk labels are internal (used in vector index metadata).
 * Display sections are user-facing (shown in results, facets, URLs).
 * toDisplaySection maps between them — no chunk label should ever
 * leak to the user without passing through this boundary.
 */
import { describe, it, expect } from 'vitest';
import { DISPLAY_SECTIONS, CHUNK_LABELS, toDisplaySection, type DisplaySection } from '../src/lib/sections';

describe('section type boundary', () => {
  it('DISPLAY_SECTIONS does not include title_summary', () => {
    expect(DISPLAY_SECTIONS).not.toContain('title_summary');
  });

  it('CHUNK_LABELS includes title_summary', () => {
    expect(CHUNK_LABELS).toContain('title_summary');
  });

  it('every DISPLAY_SECTION is also a CHUNK_LABEL', () => {
    for (const section of DISPLAY_SECTIONS) {
      expect(CHUNK_LABELS).toContain(section);
    }
  });

  it('CHUNK_LABELS has exactly one extra label beyond DISPLAY_SECTIONS', () => {
    const extra = CHUNK_LABELS.filter(l => !DISPLAY_SECTIONS.includes(l as DisplaySection));
    expect(extra).toEqual(['title_summary']);
  });
});

describe('toDisplaySection', () => {
  it('maps title_summary → lead_essay', () => {
    expect(toDisplaySection('title_summary')).toBe('lead_essay');
  });

  it('maps null → other', () => {
    expect(toDisplaySection(null)).toBe('other');
  });

  it('maps unknown strings → other', () => {
    expect(toDisplaySection('banana')).toBe('other');
    expect(toDisplaySection('')).toBe('other');
  });

  it('passes through all display sections unchanged', () => {
    for (const section of DISPLAY_SECTIONS) {
      expect(toDisplaySection(section)).toBe(section);
    }
  });

  it('lead_essay stays lead_essay (not double-mapped)', () => {
    expect(toDisplaySection('lead_essay')).toBe('lead_essay');
  });
});

describe('live API: no chunk labels in responses', () => {
  // Four sequential round trips to the deployed Worker; the vitest default
  // 5s timeout flaked in CI when broad queries ran slow. Generous explicit
  // timeouts keep the live checks without the flake.
  it('search results never have title_summary as snippet_section', async () => {
    // title_summary is the most likely leak — it's the first chunk's label
    const queries = ['systems', 'the', 'trust', 'crypto'];
    for (const q of queries) {
      const resp = await fetch(`https://flux-search.adewale-883.workers.dev/search?q=${q}&limit=20`);
      const data = await resp.json() as any;
      for (const r of data.results) {
        expect(r.snippet_section,
          `#${r.issue_number} has chunk label "${r.snippet_section}" instead of display section`
        ).not.toBe('title_summary');
      }
    }
  }, 30000);

  it('section_facets keys are all display sections', async () => {
    const resp = await fetch('https://flux-search.adewale-883.workers.dev/search?q=trust&limit=20');
    const data = await resp.json() as any;
    const validSections = new Set(DISPLAY_SECTIONS);
    for (const key of Object.keys(data.section_facets)) {
      expect(validSections.has(key as DisplaySection),
        `facet key "${key}" is not a display section`
      ).toBe(true);
    }
  }, 15000);
});
