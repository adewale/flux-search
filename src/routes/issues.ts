import { Hono } from 'hono';
import type { Env } from '../env';
import { getIssueById, getIssueByNumber } from '../db/queries';

export const issueRoutes = new Hono<{ Bindings: Env }>();

issueRoutes.get('/issues/:id', async (c) => {
  const id = c.req.param('id');
  const issue = await getIssueById(c.env.DB, id);

  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  return c.json({
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
  });
});

issueRoutes.get('/issues/issue/:number', async (c) => {
  const num = parseInt(c.req.param('number'));
  if (isNaN(num)) {
    return c.json({ error: 'Invalid issue number' }, 400);
  }

  const issue = await getIssueByNumber(c.env.DB, num);
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  return c.json({
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
  });
});
