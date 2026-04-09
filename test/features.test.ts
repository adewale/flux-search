/**
 * RED tests for new features:
 * 1. Density strip — year distribution in ranked results
 * 2. Confidence tiers — classify results into high/medium/low
 * 3. Progressive disclosure — top results get longer snippets
 * 5. Flow-based bootstrap — batch continuation logic
 */

import { describe, it, expect } from 'vitest';
import {
  rankResults,
  computeYearDistribution,
  classifyConfidence,
  type RankedResult,
} from '../src/lib/hybrid-ranker';
import { computeBatchPlan } from '../src/crawler/bootstrap';
import type { ParsedQuery } from '../src/lib/query-parser';
import type { FtsSearchResult } from '../src/db/queries';
import type { IssueRow } from '../src/db/types';

function makeIssue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: crypto.randomUUID(),
    issue_number: null, title: 'Test', subtitle: null, published_at: '2024-01-01',
    source_url: 'https://example.com/p/test', canonical_url: 'https://example.com/p/test',
    authors: null, contributors: null, summary: 'A test summary with some content here.',
    full_text_markdown: null, full_text_plain: 'Full body text for the test issue with enough words to be meaningful.',
    crawl_run_id: null, content_hash: null, ingested_at: '2024-01-01',
    word_count: 100, status: 'active', year: 2024, month: 1, has_semantic_chunks: 1,
    ...overrides,
  };
}

const defaultEnv = { LEXICAL_WEIGHT: '1.0', SEMANTIC_WEIGHT: '0.55', RRF_K: '40' } as any;
const defaultParsed: ParsedQuery = { freeText: 'test', phrases: [], filters: {}, operators: [] };

// ========================
// 1. Density Strip
// ========================
describe('computeYearDistribution', () => {
  it('counts results per year', () => {
    const results: RankedResult[] = [
      { issue: makeIssue({ year: 2023 }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
      { issue: makeIssue({ year: 2023 }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
      { issue: makeIssue({ year: 2024 }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
      { issue: makeIssue({ year: 2025 }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
    ];

    const dist = computeYearDistribution(results);

    expect(dist).toEqual({ 2023: 2, 2024: 1, 2025: 1 });
  });

  it('returns empty object for no results', () => {
    expect(computeYearDistribution([])).toEqual({});
  });

  it('skips results with null year', () => {
    const results: RankedResult[] = [
      { issue: makeIssue({ year: null }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
      { issue: makeIssue({ year: 2024 }), snippet: '', matchedBy: ['fts'], debugMeta: {} as any },
    ];

    const dist = computeYearDistribution(results);
    expect(dist).toEqual({ 2024: 1 });
  });
});

// ========================
// 2. Confidence Tiers
// ========================
describe('classifyConfidence', () => {
  it('classifies high confidence for exact issue match', () => {
    expect(classifyConfidence({
      matched_by: ['fts', 'issue_number'], lexical_rank: 1, semantic_rank: null,
      top_chunk_section: null, applied_boosts: ['exact_issue'], applied_penalties: [], final_score: 10.5,
    })).toBe('high');
  });

  it('classifies high confidence for phrase match in title', () => {
    expect(classifyConfidence({
      matched_by: ['fts', 'phrase'], lexical_rank: 1, semantic_rank: null,
      top_chunk_section: null, applied_boosts: ['phrase_title'], applied_penalties: [], final_score: 6.5,
    })).toBe('high');
  });

  it('classifies medium for lexical+semantic agreement', () => {
    expect(classifyConfidence({
      matched_by: ['fts', 'vector'], lexical_rank: 2, semantic_rank: 3,
      top_chunk_section: null, applied_boosts: ['lexical_semantic_agreement'], applied_penalties: [], final_score: 1.5,
    })).toBe('medium');
  });

  it('classifies low for semantic-only with penalty', () => {
    expect(classifyConfidence({
      matched_by: ['vector'], lexical_rank: null, semantic_rank: 5,
      top_chunk_section: null, applied_boosts: [], applied_penalties: ['semantic_only_penalty'], final_score: 0.005,
    })).toBe('low');
  });

  it('classifies medium for plain lexical match without boosts', () => {
    expect(classifyConfidence({
      matched_by: ['fts'], lexical_rank: 3, semantic_rank: null,
      top_chunk_section: null, applied_boosts: [], applied_penalties: [], final_score: 0.02,
    })).toBe('medium');
  });
});

// ========================
// 3. Progressive Disclosure
// ========================
describe('progressive snippet length', () => {
  it('top-ranked results get longer snippets than lower-ranked ones', () => {
    const issues = Array.from({ length: 6 }, (_, i) =>
      makeIssue({
        title: `Issue ${i}`,
        summary: 'A '.repeat(200), // long enough to be truncated
        full_text_plain: 'Word '.repeat(200),
      })
    );

    const lexical: FtsSearchResult[] = issues.map((issue, i) => ({
      issue, bm25Score: -(i + 1), rank: i + 1,
    }));

    const ranked = rankResults(defaultParsed, lexical, [], defaultEnv);

    // First result should have a longer snippet than the 5th
    expect(ranked[0].snippet.length).toBeGreaterThan(ranked[4].snippet.length);
  });

  it('first 3 results get extended snippets', () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({
        title: `Issue ${i}`,
        summary: 'Content word '.repeat(100),
      })
    );

    const lexical: FtsSearchResult[] = issues.map((issue, i) => ({
      issue, bm25Score: -(i + 1), rank: i + 1,
    }));

    const ranked = rankResults(defaultParsed, lexical, [], defaultEnv);

    // Top 3 should all have same (longer) snippet length ceiling
    const top3Lengths = ranked.slice(0, 3).map(r => r.snippet.length);
    const restLengths = ranked.slice(3).map(r => r.snippet.length);

    // Top 3 snippets should be at least as long as the rest
    expect(Math.min(...top3Lengths)).toBeGreaterThanOrEqual(Math.max(...restLengths));
  });
});

// ========================
// 5. Flow-based Bootstrap
// ========================
describe('computeBatchPlan', () => {
  it('returns all URLs when none are ingested', () => {
    const discovered = [
      'https://example.com/p/1',
      'https://example.com/p/2',
      'https://example.com/p/3',
    ];
    const existing = new Set<string>();

    const plan = computeBatchPlan(discovered, existing, 10);
    expect(plan.toProcess).toEqual(discovered);
    expect(plan.remaining).toBe(0);
    expect(plan.done).toBe(false);
  });

  it('skips already-ingested URLs', () => {
    const discovered = [
      'https://example.com/p/1',
      'https://example.com/p/2',
      'https://example.com/p/3',
    ];
    const existing = new Set(['https://example.com/p/1', 'https://example.com/p/2']);

    const plan = computeBatchPlan(discovered, existing, 10);
    expect(plan.toProcess).toEqual(['https://example.com/p/3']);
    expect(plan.remaining).toBe(0);
    expect(plan.done).toBe(false);
  });

  it('caps batch size', () => {
    const discovered = Array.from({ length: 50 }, (_, i) => `https://example.com/p/${i}`);
    const existing = new Set<string>();

    const plan = computeBatchPlan(discovered, existing, 20);
    expect(plan.toProcess).toHaveLength(20);
    expect(plan.remaining).toBe(30);
    expect(plan.done).toBe(false);
  });

  it('reports done when all are ingested', () => {
    const discovered = ['https://example.com/p/1'];
    const existing = new Set(['https://example.com/p/1']);

    const plan = computeBatchPlan(discovered, existing, 10);
    expect(plan.toProcess).toHaveLength(0);
    expect(plan.done).toBe(true);
  });
});
