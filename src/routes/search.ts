import { Hono } from 'hono';
import type { Env } from '../env';
import { parseQuery } from '../lib/query-parser';
import { searchFts, autocompleteWords, getIssueByNumber } from '../db/queries';
import { searchVectorize } from '../lib/vector-search';
import { rankResults, computeYearDistribution, computeSectionFacets } from '../lib/hybrid-ranker';

export const searchRoutes = new Hono<{ Bindings: Env }>();

searchRoutes.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const debug = c.req.query('debug') === 'true';

  if (!q.trim()) {
    return c.json({
      parsed_query: null,
      applied_filters: [],
      total_hits: 0,
      results: [],
    });
  }

  const parsed = parseQuery(q);

  // Direct issue number lookup — short circuit
  if (parsed.filters.issueNumber && !parsed.freeText.trim() && parsed.phrases.length === 0) {
    const issue = await getIssueByNumber(c.env.DB, parsed.filters.issueNumber);
    if (issue) {
      return c.json({
        parsed_query: parsed,
        applied_filters: parsed.operators,
        total_hits: 1,
        results: [{
          issue_id: issue.id,
          title: issue.title,
          issue_number: issue.issue_number,
          published_at: issue.published_at,
          snippet: issue.summary || '',
          canonical_url: issue.canonical_url || issue.source_url,
          matched_by: ['issue_number'],
          ...(debug ? { debug: { final_score: 10, lexical_rank: null, semantic_rank: null } } : {}),
        }],
      });
    }
  }

  // Run lexical and semantic search in parallel
  const ftsQuery = buildFtsQuery(parsed);
  const semanticQuery = [parsed.freeText, ...parsed.phrases].filter(Boolean).join(' ');

  const [lexicalResults, semanticResults] = await Promise.all([
    ftsQuery ? searchFts(c.env.DB, ftsQuery, parsed.filters) : Promise.resolve([]),
    semanticQuery ? searchVectorize(c.env, semanticQuery, parsed.filters) : Promise.resolve([]),
  ]);

  let ranked = rankResults(parsed, lexicalResults, semanticResults, c.env);

  // Section filter — post-ranking filter on snippet section
  if (parsed.filters.section) {
    const sect = parsed.filters.section;
    ranked = ranked.filter(r =>
      r.snippetSection === sect ||
      r.debugMeta.top_chunk_section?.toLowerCase().includes(sect)
    );
  }

  // Paginate
  const offset = (page - 1) * limit;
  const paged = ranked.slice(offset, offset + limit);

  return c.json({
    parsed_query: {
      free_text: parsed.freeText,
      phrases: parsed.phrases,
      filters: parsed.filters,
    },
    applied_filters: parsed.operators,
    total_hits: ranked.length,
    year_distribution: computeYearDistribution(ranked),
    section_facets: computeSectionFacets(ranked),
    results: paged.map(r => ({
      issue_id: r.issue.id,
      title: r.issue.title,
      issue_number: r.issue.issue_number,
      published_at: r.issue.published_at,
      snippet: r.snippet,
      snippet_section: r.snippetSection,
      confidence: r.confidence,
      canonical_url: r.issue.canonical_url || r.issue.source_url,
      matched_by: r.matchedBy,
      ...(debug ? { debug: r.debugMeta } : {}),
    })),
  });
});

searchRoutes.get('/autocomplete', async (c) => {
  const q = c.req.query('q') || '';
  const lastToken = q.split(/\s+/).pop() || '';

  if (lastToken.length < 2) {
    return c.json({ suggestions: [] });
  }

  const words = await autocompleteWords(c.env.DB, lastToken.toLowerCase());

  return c.json({
    suggestions: words.map(w => ({ type: 'word', value: w })),
  });
});

export function buildFtsQuery(parsed: ReturnType<typeof parseQuery>): string {
  const parts: string[] = [];

  for (const phrase of parsed.phrases) {
    parts.push(`"${phrase}"`);
  }

  const freeTerms = parsed.freeText.trim();
  if (freeTerms) {
    parts.push(freeTerms);
  }

  return parts.join(' ');
}
