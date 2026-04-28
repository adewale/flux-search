import { Hono } from 'hono';
import type { Env } from '../env';
import { adminAuth } from '../middleware/admin-auth';
import { getCrawlRun, getIssueCount, getIssueDateRange, getMissingIssueNumbers } from '../db/queries';
import { runBootstrap } from '../crawler/bootstrap';
import { runReindex } from '../crawler/ingestor';
import { rebuildAllTopics } from '../lib/topic-rebuild';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use('*', adminAuth);

adminRoutes.post('/bootstrap', async (c) => {
  const crawlRunId = crypto.randomUUID();
  const force = c.req.query('force') === 'true';
  const offset = parseInt(c.req.query('offset') || '0') || 0;

  // Start bootstrap in background — returns immediately
  c.executionCtx.waitUntil(
    runBootstrap(c.env, crawlRunId, { force, offset }).catch(err => {
      console.error('Bootstrap failed:', err);
    })
  );

  return c.json({
    message: force ? 'Force bootstrap started' : 'Bootstrap started',
    crawl_run_id: crawlRunId,
  }, 202);
});

adminRoutes.post('/reindex', async (c) => {
  const crawlRunId = crypto.randomUUID();

  c.executionCtx.waitUntil(
    runReindex(c.env, crawlRunId).catch(err => {
      console.error('Reindex failed:', err);
    })
  );

  return c.json({
    message: 'Reindex started',
    crawl_run_id: crawlRunId,
  }, 202);
});

adminRoutes.get('/crawl-runs/:id', async (c) => {
  const id = c.req.param('id');
  const run = await getCrawlRun(c.env.DB, id);

  if (!run) {
    return c.json({ error: 'Crawl run not found' }, 404);
  }

  return c.json(run);
});

adminRoutes.post('/rebuild-topics', async (c) => {
  c.executionCtx.waitUntil(
    rebuildAllTopics(c.env.DB)
      .then(stats => console.log('rebuild-topics done:', stats))
      .catch(err => console.error('rebuild-topics failed:', err))
  );

  return c.json({ message: 'Topic rebuild started' }, 202);
});

adminRoutes.get('/coverage', async (c) => {
  const [count, dateRange, missing] = await Promise.all([
    getIssueCount(c.env.DB),
    getIssueDateRange(c.env.DB),
    getMissingIssueNumbers(c.env.DB),
  ]);

  return c.json({
    total_issues: count,
    first_issue_date: dateRange.first,
    last_issue_date: dateRange.last,
    missing_issue_numbers: missing,
    missing_count: missing.length,
  });
});
