import type { IssueRow } from '../src/db/types';
import type { FtsSearchResult } from '../src/db/queries';
import type { SemanticCandidate } from '../src/lib/vector-search';

export function makeIssue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: crypto.randomUUID(),
    issue_number: null,
    title: 'Test',
    subtitle: null,
    published_at: '2024-01-01',
    source_url: 'https://example.com/p/test',
    canonical_url: 'https://example.com/p/test',
    authors: null,
    contributors: null,
    summary: 'A summary.',
    headings: null,
    lead_essay_title: null,
    opening_quote: null,
    full_text_markdown: null,
    full_text_plain: 'Body text.',
    crawl_run_id: null,
    content_hash: null,
    ingested_at: '2024-01-01',
    word_count: 100,
    status: 'active',
    year: 2024,
    month: 1,
    has_semantic_chunks: 1,
    ...overrides,
  };
}

export function makeFtsResult(issue: IssueRow, rank: number, highlightSnippet: string | null = null): FtsSearchResult {
  return { issue, bm25Score: -rank, rank, highlightSnippet };
}

export function makeSemanticCandidate(issue: IssueRow, rank: number): SemanticCandidate {
  return {
    issueId: issue.id,
    issue,
    topScore: 1 - rank * 0.1,
    topChunkSection: 'body',
    topChunkText: 'Some matching chunk text',
    chunkCount: 1,
    rank,
  };
}

export const defaultEnv = {
  LEXICAL_WEIGHT: '1.0',
  SEMANTIC_WEIGHT: '0.55',
  RRF_K: '40',
} as any;
