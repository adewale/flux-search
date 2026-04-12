import { Hono } from 'hono';
import type { Env } from '../env';
import { parseQuery, isFilterOnly } from '../lib/query-parser';
import { searchFts, searchFilterOnly, autocompleteWords, getIssueByNumber } from '../db/queries';
import { searchVectorize } from '../lib/vector-search';
import { rankResults, computeYearDistribution, computeQuarterSectionDistribution, computeSectionFacets, detectSnippetSection } from '../lib/hybrid-ranker';
import { parseSections } from '../lib/sections';

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
      // Detect section from summary snippet
      let snippetSection: string | null = null;
      if (issue.full_text_markdown) {
        const sections = parseSections(issue.full_text_markdown);
        if (sections.length > 0) snippetSection = sections[0].type;
      }

      const yearDist: Record<number, number> = {};
      if (issue.year) yearDist[issue.year] = 1;

      const qKey = issue.published_at
        ? new Date(issue.published_at + 'T00:00:00Z').getUTCFullYear() + '-Q' +
          (Math.floor(new Date(issue.published_at + 'T00:00:00Z').getUTCMonth() / 3) + 1)
        : null;
      const quarterDist: Record<string, Record<string, number>> = {};
      if (qKey) quarterDist[qKey] = { [snippetSection || 'other']: 1 };

      return c.json({
        parsed_query: parsed,
        applied_filters: parsed.operators,
        total_hits: 1,
        year_distribution: yearDist,
        quarter_distribution: quarterDist,
        section_facets: { [snippetSection || 'other']: 1 },
        results: [{
          issue_id: issue.id,
          title: issue.title,
          issue_number: issue.issue_number,
          published_at: issue.published_at,
          snippet: issue.summary || '',
          snippet_section: snippetSection,
          confidence: 'high',
          canonical_url: issue.canonical_url || issue.source_url,
          matched_by: ['issue_number'],
          ...(debug ? { debug: { final_score: 10, lexical_rank: null, semantic_rank: null } } : {}),
        }],
      });
    }
  }

  // Filter-only queries (e.g. "before:2024") — no search terms, just filters
  if (isFilterOnly(parsed)) {
    const filterResults = await searchFilterOnly(c.env.DB, parsed.filters);

    // Detect sections for all filter results
    const sectionFilter = parsed.filters.section;
    let withSections = filterResults.issues.map(issue => {
      let snippetSection: string | null = null;
      if (issue.full_text_markdown) {
        const sections = parseSections(issue.full_text_markdown);
        if (sectionFilter) {
          // When filtering by section, find that specific section
          const match = sections.find(s => s.type === sectionFilter);
          if (match) snippetSection = match.type;
        } else if (sections.length > 0) {
          snippetSection = sections[0].type;
        }
      }
      return { issue, snippetSection };
    });

    // Apply section filter if present
    if (sectionFilter) {
      withSections = withSections.filter(r => r.snippetSection === sectionFilter);
    }

    const yearDist: Record<number, number> = {};
    const quarterSectionDist: Record<string, Record<string, number>> = {};
    const sectionFacets: Record<string, number> = {};

    for (const { issue, snippetSection } of withSections) {
      const section = snippetSection || 'other';
      sectionFacets[section] = (sectionFacets[section] || 0) + 1;
      if (issue.year) yearDist[issue.year] = (yearDist[issue.year] || 0) + 1;
      if (issue.published_at) {
        const d = new Date(issue.published_at + 'T00:00:00Z');
        const qKey = d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
        if (!quarterSectionDist[qKey]) quarterSectionDist[qKey] = {};
        quarterSectionDist[qKey][section] = (quarterSectionDist[qKey][section] || 0) + 1;
      }
    }

    const offset = (page - 1) * limit;

    return c.json({
      parsed_query: { free_text: parsed.freeText, phrases: parsed.phrases, filters: parsed.filters },
      applied_filters: parsed.operators,
      total_hits: withSections.length,
      year_distribution: yearDist,
      quarter_distribution: quarterSectionDist,
      section_facets: sectionFacets,
      results: withSections.slice(offset, offset + limit).map(({ issue, snippetSection }) => ({
        issue_id: issue.id,
        title: issue.title,
        issue_number: issue.issue_number,
        published_at: issue.published_at,
        snippet: issue.summary || '',
        snippet_section: snippetSection,
        confidence: 'medium',
        canonical_url: issue.canonical_url || issue.source_url,
        matched_by: ['filter'],
      })),
    });
  }

  // Run lexical and semantic search in parallel
  const ftsQuery = buildFtsQuery(parsed);
  const semanticQuery = [parsed.freeText, ...parsed.phrases].filter(Boolean).join(' ');

  const [lexicalResults, semanticResults] = await Promise.all([
    ftsQuery ? searchFts(c.env.DB, ftsQuery, parsed.filters) : Promise.resolve([]),
    semanticQuery ? searchVectorize(c.env, semanticQuery, parsed.filters) : Promise.resolve([]),
  ]);

  let ranked = rankResults(parsed, lexicalResults, semanticResults, c.env);

  // Detect section for ALL results first — must run before filtering
  // and aggregates so that FTS-only results (which have null snippetSection
  // from the ranker) get their sections filled in.
  for (const r of ranked) {
    if (!r.snippetSection && r.snippet && r.issue.full_text_markdown) {
      const sections = parseSections(r.issue.full_text_markdown);
      r.snippetSection = detectSnippetSection(r.snippet, sections);
    }
  }

  // Section filter — now runs after detection so FTS results are filterable
  if (parsed.filters.section) {
    const sectionFilter = parsed.filters.section;
    ranked = ranked.filter(r => r.snippetSection === sectionFilter);
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
    quarter_distribution: computeQuarterSectionDistribution(ranked),
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

// Latest issue for the landing page
searchRoutes.get('/latest-issue', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT issue_number, title, lead_essay_title, published_at, opening_quote, summary,
           canonical_url, source_url
    FROM issues
    WHERE status = 'active' AND issue_number IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 1
  `).first<{
    issue_number: number; title: string; lead_essay_title: string | null;
    published_at: string; opening_quote: string | null; summary: string | null;
    canonical_url: string | null; source_url: string;
  }>();

  if (!result) return c.json({ issue: null });

  return c.json({
    issue_number: result.issue_number,
    title: result.lead_essay_title || result.title,
    published_at: result.published_at,
    opening_quote: result.opening_quote,
    summary: result.summary,
    canonical_url: result.canonical_url || result.source_url,
  });
});

// Random quote for the landing page empty state
searchRoutes.get('/random-quote', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT issue_number, title, opening_quote, lead_essay_title
    FROM issues
    WHERE status = 'active' AND opening_quote IS NOT NULL AND opening_quote != ''
    ORDER BY RANDOM()
    LIMIT 1
  `).first<{ issue_number: number; title: string; opening_quote: string; lead_essay_title: string | null }>();

  if (!result) return c.json({ quote: null });

  return c.json({
    quote: result.opening_quote,
    title: result.lead_essay_title || result.title,
    issue_number: result.issue_number,
  });
});
