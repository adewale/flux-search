/**
 * Property-based test: search response internal consistency.
 *
 * Every search response must satisfy:
 * 1. total_hits == sum(quarter_distribution values)
 * 2. total_hits == sum(year_distribution values)
 * 3. section_facets total <= total_hits (every faceted result is a hit)
 * 4. section_facets total >= total_hits - (small tolerance for undetectable sections)
 * 5. quarter_distribution section totals == section_facets totals
 * 6. No result on the page has snippet_section=null when section detection is possible
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { rankResults, computeYearDistribution, computeQuarterDistribution, computeQuarterSectionDistribution, computeSectionFacets } from '../src/lib/hybrid-ranker';
import type { RankedResult } from '../src/lib/hybrid-ranker';
import type { IssueRow } from '../src/db/types';

function makeFakeResult(overrides: Partial<{ published_at: string; snippetSection: string | null }>): RankedResult {
  const published_at = overrides.published_at || '2023-06-15';
  const d = new Date(published_at + 'T00:00:00Z');
  return {
    issue: {
      id: crypto.randomUUID(),
      published_at,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      title: 'Test',
    } as IssueRow,
    snippet: 'test snippet',
    snippetSection: overrides.snippetSection ?? null,
    matchedBy: ['fts'],
    confidence: 'medium',
    debugMeta: {
      matched_by: ['fts'],
      lexical_rank: 1,
      semantic_rank: null,
      semantic_score: null,
      top_chunk_section: null,
      applied_boosts: [],
      applied_penalties: [],
      final_score: 1,
    },
  };
}

const SECTIONS = ['lead_essay', 'signposts', 'lens', 'book', 'postcard', 'worth_your_time', 'other', null];

describe('search response consistency (PBT)', () => {
  it('year_distribution total always equals result count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            published_at: fc.integer({ min: 2021, max: 2026 }).chain(y =>
                fc.integer({ min: 1, max: 12 }).chain(m =>
                  fc.integer({ min: 1, max: 28 }).map(d =>
                    y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                  )
                )
              ),
            section: fc.constantFrom(...SECTIONS),
          }),
          { minLength: 0, maxLength: 50 }
        ),
        (items) => {
          const results = items.map(i => makeFakeResult({ published_at: i.published_at, snippetSection: i.section }));
          const yearDist = computeYearDistribution(results);
          const total = Object.values(yearDist).reduce((a, b) => a + b, 0);
          expect(total).toBe(results.length);
        }
      )
    );
  });

  it('quarter_distribution total always equals result count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.date({ min: new Date(2021, 0, 1), max: new Date(2026, 11, 31) })
            .map(d => d.toISOString().slice(0, 10)),
          { minLength: 0, maxLength: 50 }
        ),
        (dates) => {
          const results = dates.map(d => makeFakeResult({ published_at: d }));
          const qd = computeQuarterDistribution(results);
          const total = Object.values(qd).reduce((a, b) => a + b, 0);
          expect(total).toBe(results.length);
        }
      )
    );
  });

  it('section_facets total equals result count when all sections are set', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            published_at: fc.integer({ min: 2021, max: 2026 }).chain(y =>
                fc.integer({ min: 1, max: 12 }).chain(m =>
                  fc.integer({ min: 1, max: 28 }).map(d =>
                    y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                  )
                )
              ),
            section: fc.constantFrom('lead_essay', 'signposts', 'lens', 'book', 'postcard', 'worth_your_time', 'other'),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (items) => {
          const results = items.map(i => makeFakeResult({ published_at: i.published_at, snippetSection: i.section }));
          const facets = computeSectionFacets(results);
          const facetTotal = Object.values(facets).reduce((a, b) => a + b, 0);
          // When all results have sections, facet total must equal result count
          expect(facetTotal).toBe(results.length);
        }
      )
    );
  });

  it('quarter_section_distribution totals match quarter_distribution', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            published_at: fc.integer({ min: 2021, max: 2026 }).chain(y =>
                fc.integer({ min: 1, max: 12 }).chain(m =>
                  fc.integer({ min: 1, max: 28 }).map(d =>
                    y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                  )
                )
              ),
            section: fc.constantFrom('lead_essay', 'signposts', 'lens', 'other'),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (items) => {
          const results = items.map(i => makeFakeResult({ published_at: i.published_at, snippetSection: i.section }));
          const qd = computeQuarterDistribution(results);
          const qsd = computeQuarterSectionDistribution(results);

          // Every quarter's section subtotals should equal the quarter total
          for (const [quarter, sectionCounts] of Object.entries(qsd)) {
            const sectionTotal = Object.values(sectionCounts).reduce((a, b) => a + b, 0);
            expect(sectionTotal).toBe(qd[quarter]);
          }
        }
      )
    );
  });

  it('section_facets total equals result count even with null sections (RED: the real bug)', () => {
    // This is the actual bug: when snippetSection is null (FTS-only results),
    // section_facets undercounts because it skips nulls. After fix, all results
    // should have a section assigned before facets are computed.
    const results = [
      makeFakeResult({ published_at: '2022-01-15', snippetSection: 'lead_essay' }),
      makeFakeResult({ published_at: '2022-03-10', snippetSection: null }),
      makeFakeResult({ published_at: '2023-06-01', snippetSection: 'signposts' }),
      makeFakeResult({ published_at: '2023-09-15', snippetSection: null }),
      makeFakeResult({ published_at: '2024-01-10', snippetSection: null }),
    ];
    const facets = computeSectionFacets(results);
    const facetTotal = Object.values(facets).reduce((a, b) => a + b, 0);
    // After fix: all 5 results should appear in facets (nulls get 'other')
    expect(facetTotal).toBe(results.length);
  });

  it('section_facets total matches quarter_section_distribution section totals', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            published_at: fc.integer({ min: 2021, max: 2026 }).chain(y =>
                fc.integer({ min: 1, max: 12 }).chain(m =>
                  fc.integer({ min: 1, max: 28 }).map(d =>
                    y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
                  )
                )
              ),
            section: fc.constantFrom('lead_essay', 'signposts', 'lens', 'book', 'other'),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (items) => {
          const results = items.map(i => makeFakeResult({ published_at: i.published_at, snippetSection: i.section }));
          const facets = computeSectionFacets(results);
          const qsd = computeQuarterSectionDistribution(results);

          // Sum each section across all quarters
          const qsdSectionTotals: Record<string, number> = {};
          for (const sectionCounts of Object.values(qsd)) {
            for (const [section, count] of Object.entries(sectionCounts)) {
              qsdSectionTotals[section] = (qsdSectionTotals[section] || 0) + count;
            }
          }

          // Should match the facet counts exactly
          expect(qsdSectionTotals).toEqual(facets);
        }
      )
    );
  });
});
