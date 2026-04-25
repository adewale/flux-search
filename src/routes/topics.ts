import { Hono } from 'hono';
import type { Env } from '../env';
import {
  getCorpusTopics,
  getTopicTimeline,
  getIssueIdsByTopic,
} from '../db/topic-queries';
import { normalizeKeyword } from '../lib/topic-extractor';
import type { IssueRow } from '../db/types';

export const topicRoutes = new Hono<{ Bindings: Env }>();

topicRoutes.get('/topics', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    return c.env.ASSETS.fetch(new Request(new URL('/topics.html', c.req.url)));
  }

  const sortParam = c.req.query('sort');
  const sort: 'frequency' | 'recency' | 'alpha' =
    sortParam === 'recency' ? 'recency' :
    sortParam === 'alpha' ? 'alpha' :
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
  ).bind(keyword).first<{ keyword: string; keyword_display: string; doc_frequency: number; aggregate_score: number; first_seen: string | null; last_seen: string | null }>();

  const issueIds = await getIssueIdsByTopic(c.env.DB, keyword);
  if (!corpusRow && issueIds.length === 0) {
    return c.json({ error: 'Topic not found' }, 404);
  }

  const issues = issueIds.length === 0 ? [] : await fetchIssuesById(c.env.DB, issueIds);
  const timeline = await getTopicTimeline(c.env.DB, keyword);

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
    first_seen: corpusRow?.first_seen ?? null,
    last_seen: corpusRow?.last_seen ?? null,
    issues: issues.map(i => ({
      issue_id: i.id,
      issue_number: i.issue_number,
      title: i.title,
      published_at: i.published_at,
      canonical_url: i.canonical_url || i.source_url,
    })),
    timeline: timeline.map(t => ({ year: t.year, month: t.month, occurrences: t.occurrences })),
  });
});

async function fetchIssuesById(db: D1Database, ids: string[]): Promise<IssueRow[]> {
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT * FROM issues WHERE id IN (${placeholders}) AND status = 'active' ORDER BY published_at DESC`,
  ).bind(...ids).all<IssueRow>();
  return result.results;
}
