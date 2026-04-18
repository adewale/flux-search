import { Hono } from 'hono';
import type { Env } from '../env';
import type { IssueRow, IssueTopicRow } from '../db/types';
import { getIssueById, getIssueByNumber } from '../db/queries';
import { getTopicsByIssueId } from '../db/topic-queries';
import { parseSections } from '../lib/sections';

export const issueRoutes = new Hono<{ Bindings: Env }>();

function formatIssueResponse(issue: IssueRow, topics: IssueTopicRow[] = []) {
  return {
    id: issue.id,
    issue_number: issue.issue_number,
    title: issue.title,
    subtitle: issue.subtitle,
    published_at: issue.published_at,
    source_url: issue.source_url,
    canonical_url: issue.canonical_url,
    authors: issue.authors,
    contributors: issue.contributors,
    summary: issue.summary,
    body_markdown: issue.full_text_markdown,
    word_count: issue.word_count,
    year: issue.year,
    month: issue.month,
    topics: topics.map(t => ({
      keyword: t.keyword,
      keyword_display: t.keyword_display,
      score: t.score,
      rank: t.rank,
    })),
  };
}

issueRoutes.get('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = await getIssueById(c.env.DB, id);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);
  const topics = await getTopicsByIssueId(c.env.DB, issue.id);
  return c.json(formatIssueResponse(issue, topics));
});

issueRoutes.get('/issues/issue/:number', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num)) return c.json({ error: 'Invalid issue number' }, 400);

  // Serve HTML page for browser requests, JSON for API requests
  const accept = c.req.header('Accept') || '';
  if (accept.includes('text/html')) {
    // Serve issue.html via the ASSETS binding
    return c.env.ASSETS.fetch(new Request(new URL('/issue.html', c.req.url)));
  }

  const issue = await getIssueByNumber(c.env.DB, num);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);
  const topics = await getTopicsByIssueId(c.env.DB, issue.id);
  return c.json(formatIssueResponse(issue, topics));
});

// Section-level landing page API
issueRoutes.get('/issues/issue/:number/sections', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num)) return c.json({ error: 'Invalid issue number' }, 400);

  const issue = await getIssueByNumber(c.env.DB, num);
  if (!issue) return c.json({ error: 'Issue not found' }, 404);

  const sections = issue.full_text_markdown
    ? parseSections(issue.full_text_markdown)
    : [];

  // Find prev/next issue numbers
  const prevResult = await c.env.DB.prepare(
    'SELECT issue_number FROM issues WHERE issue_number < ? AND status = ? ORDER BY issue_number DESC LIMIT 1'
  ).bind(num, 'active').first<{ issue_number: number }>();

  const nextResult = await c.env.DB.prepare(
    'SELECT issue_number FROM issues WHERE issue_number > ? AND status = ? ORDER BY issue_number ASC LIMIT 1'
  ).bind(num, 'active').first<{ issue_number: number }>();

  return c.json({
    issue_number: issue.issue_number,
    title: issue.title,
    published_at: issue.published_at,
    canonical_url: issue.canonical_url || issue.source_url,
    opening_quote: issue.opening_quote,
    sections: sections.map(s => ({
      type: s.type,
      title: s.title,
      body: s.body,
    })),
    prev_issue_number: prevResult?.issue_number ?? null,
    next_issue_number: nextResult?.issue_number ?? null,
  });
});
