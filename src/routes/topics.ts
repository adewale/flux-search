import { Hono } from 'hono';
import type { Env } from '../env';
import {
  getCorpusTopics,
  getTopicTimeline,
  getIssueIdsByTopic,
  getAdjacentTopics,
  getTopicSimilarities,
} from '../db/topic-queries';
import { normalizeKeyword } from '../lib/topic-extractor';
import { computeTerminologyDrift } from '../lib/terminology-drift';
import type { IssueRow } from '../db/types';

export const topicRoutes = new Hono<{ Bindings: Env }>();

topicRoutes.get('/topics', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.env.ASSETS.fetch(new Request(new URL('/topics.html', c.req.url)));
  }

  const sortParam = c.req.query('sort');
  const sort: 'frequency' | 'recency' | 'alpha' | 'burst' =
    sortParam === 'recency' ? 'recency' :
    sortParam === 'alpha' ? 'alpha' :
    sortParam === 'burst' ? 'burst' :
    'frequency';
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '50') || 50));
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0') || 0);

  const topics = await getCorpusTopics(c.env.DB, { sort, limit, offset });
  return c.json({ topics, sort, limit, offset });
});

topicRoutes.get('/topics/:keyword', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.env.ASSETS.fetch(new Request(new URL('/topics.html', c.req.url)));
  }

  const raw = decodeURIComponent(c.req.param('keyword'));
  const keyword = normalizeKeyword(raw);
  if (!keyword) return c.json({ error: 'Invalid topic' }, 400);

  const corpusRow = await c.env.DB.prepare(
    'SELECT * FROM corpus_topics WHERE keyword = ?',
  ).bind(keyword).first<{
    keyword: string; keyword_display: string; doc_frequency: number;
    aggregate_score: number; first_seen: string | null; last_seen: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    burst_score: number | null; burst_quarter: string | null;
  }>();

  const issueIds = await getIssueIdsByTopic(c.env.DB, keyword);
  if (!corpusRow && issueIds.length === 0) {
    return c.json({ error: 'Topic not found' }, 404);
  }

  const issues = issueIds.length === 0 ? [] : await fetchIssuesById(c.env.DB, issueIds);
  const timeline = await getTopicTimeline(c.env.DB, keyword);
  const adjacent = await getAdjacentTopics(c.env.DB, keyword, 12);
  // Cosine-validated adjacency. Empty when the embedding pass hasn't
  // run; the route still falls back to Jaccard adjacency above.
  const similar = await getTopicSimilarities(c.env.DB, keyword, 12);
  // Terminology drift: walk the issue texts and compute per-quarter
  // distinctive context. Cheap because we already have the texts in
  // memory from the issues query above.
  const drift = computeTerminologyDrift(
    keyword,
    issues
      .filter(i => i.full_text_plain && i.published_at)
      .map(i => {
        const d = new Date((i.published_at ?? '') + 'T00:00:00Z');
        return {
          text: i.full_text_plain ?? '',
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
        };
      }),
  );

  // Pick a display form: prefer the corpus row, else the first issue's display.
  const fallbackDisplay =
    (await c.env.DB.prepare(
      'SELECT keyword_display FROM issue_topics WHERE keyword = ? ORDER BY score ASC LIMIT 1',
    ).bind(keyword).first<{ keyword_display: string }>())?.keyword_display ?? keyword;

  return c.json({
    keyword,
    keyword_display: corpusRow?.keyword_display ?? fallbackDisplay,
    doc_frequency: corpusRow?.doc_frequency ?? issueIds.length,
    aggregate_score: corpusRow?.aggregate_score ?? null,
    confidence: (corpusRow as any)?.confidence ?? null,
    burst_score: (corpusRow as any)?.burst_score ?? null,
    burst_quarter: (corpusRow as any)?.burst_quarter ?? null,
    first_seen: corpusRow?.first_seen ?? null,
    last_seen: corpusRow?.last_seen ?? null,
    drift,
    similar,
    issues: issues.map(i => ({
      issue_id: i.id,
      issue_number: i.issue_number,
      title: i.title,
      published_at: i.published_at,
      canonical_url: i.canonical_url || i.source_url,
    })),
    timeline: timeline.map(t => ({ year: t.year, month: t.month, occurrences: t.occurrences })),
    adjacent,
  });
});

async function fetchIssuesById(db: D1Database, ids: string[]): Promise<IssueRow[]> {
  // D1 has a low per-statement bind parameter ceiling in production.
  // Popular topics such as "systems thinking" can reference more than
  // 100 issues, so read in chunks instead of building one large IN list.
  const chunkSize = 75;
  const rows: IssueRow[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.prepare(
      `SELECT * FROM issues WHERE id IN (${placeholders}) AND status = 'active'`,
    ).bind(...chunk).all<IssueRow>();
    rows.push(...result.results);
  }
  return rows.sort((a, b) => String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')));
}
