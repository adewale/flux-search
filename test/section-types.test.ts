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
import { seedIssue } from './helpers-d1';
import { searchDb, searchRoute, fakeAi, fakeVectorize } from './helpers-search-route';

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

describe('search route: no chunk labels in responses (Vectorize double)', () => {
  // Vector matches carry the internal chunk label (title_summary for the
  // first chunk of every issue). The route must map it to a display section
  // before it reaches results or facets.
  async function env() {
    const db = searchDb();
    await seedIssue(db, {
      id: 'issue-10', issue_number: 10, title: 'Systems of trust',
      full_text_plain: 'Systems of trust and crypto.', source_url: 'https://example.com/p/10',
      full_text_markdown: '## 🪧 Signposts\n\nSystems of trust and crypto.',
    });
    await seedIssue(db, {
      id: 'issue-11', issue_number: 11, title: 'Unrelated title',
      full_text_plain: 'Nothing lexical here.', source_url: 'https://example.com/p/11',
    });
    const vectorize = fakeVectorize([
      { id: 'issue-10-0', score: 0.93, metadata: { issue_id: 'issue-10', section_label: 'title_summary', chunk_text: 'Systems of trust' } },
      { id: 'issue-11-0', score: 0.91, metadata: { issue_id: 'issue-11', section_label: 'title_summary', chunk_text: 'Unrelated title' } },
    ]);
    return { DB: db, AI: fakeAi(), VECTORIZE: vectorize, vectorize };
  }

  it('search results never have title_summary as snippet_section', async () => {
    for (const q of ['systems', 'the', 'trust', 'crypto']) {
      const e = await env();
      const { status, body } = await searchRoute(e, q, { limit: '20' });
      expect(status).toBe(200);
      // Precondition: the double was queried and returned title_summary
      // chunks, so the assertion below is not vacuous.
      expect(e.vectorize.calls.length, q).toBe(1);
      expect(body.results.some((r: any) => r.matched_by.includes('vector')), q).toBe(true);
      for (const r of body.results) {
        expect(r.snippet_section,
          `#${r.issue_number} has chunk label "${r.snippet_section}" instead of display section`
        ).not.toBe('title_summary');
      }
    }
  });

  it('section_facets keys are all display sections', async () => {
    const { status, body } = await searchRoute(await env(), 'trust', { limit: '20' });
    expect(status).toBe(200);
    expect(Object.keys(body.section_facets).length).toBeGreaterThan(0);
    const validSections = new Set(DISPLAY_SECTIONS);
    for (const key of Object.keys(body.section_facets)) {
      expect(validSections.has(key as DisplaySection),
        `facet key "${key}" is not a display section`
      ).toBe(true);
    }
  });
});
