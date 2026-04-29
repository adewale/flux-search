import { Hono } from 'hono';
import type { Env } from '../env';
import { adminAuth } from '../middleware/admin-auth';
import { getCrawlRun, getIssueCount, getIssueDateRange, getMissingIssueNumbers } from '../db/queries';
import { runBootstrap } from '../crawler/bootstrap';
import { runReindex } from '../crawler/ingestor';
import { rebuildAllTopics } from '../lib/topic-rebuild';
import { extractTopicsMulti } from '../lib/topic-multi-extract';
import { enqueueCorpusTopicEmbedding, type EnrichmentMessage } from '../jobs/enrichment-queue';
import { listPipelineJobs } from '../lib/pipeline-jobs';

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
  c.executionCtx.waitUntil((async () => {
    const stats = await rebuildAllTopics(c.env.DB);
    const queued = await enqueueCorpusTopicEmbedding(c.env, crypto.randomUUID());
    console.log('rebuild-topics done:', { ...stats, queued_embedding_batches: queued });
  })().catch(err => console.error('rebuild-topics failed:', err)));

  return c.json({ message: 'Topic rebuild started' }, 202);
});

adminRoutes.get('/pipeline-runs', async (c) => {
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const rows = await c.env.DB.prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?')
    .bind(limit).all();
  return c.json({ runs: rows.results });
});

adminRoutes.get('/pipeline-runs/:id/jobs', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100')));
  const jobs = await listPipelineJobs(c.env.DB, id, limit);
  return c.json({ run_id: id, jobs });
});

adminRoutes.post('/dlq/replay', async (c) => {
  if (!c.env.ENRICHMENT_QUEUE) return c.json({ error: 'Queue binding unavailable' }, 503);
  const body = await c.req.json().catch(() => null) as null | { message?: EnrichmentMessage; messages?: EnrichmentMessage[] };
  const messages = Array.isArray(body?.messages) ? body.messages : body?.message ? [body.message] : [];
  if (messages.length === 0) return c.json({ error: 'Expected message or messages' }, 400);
  await c.env.ENRICHMENT_QUEUE.sendBatch(messages.map(message => ({ body: message })));
  return c.json({ replayed: messages.length });
});

adminRoutes.get('/topic-audit', async (c) => {
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20')));
  const rows = await c.env.DB.prepare(`
    SELECT id, issue_number, title, full_text_plain
    FROM issues
    WHERE status = 'active'
    ORDER BY RANDOM()
    LIMIT ?
  `).bind(limit).all<{ id: string; issue_number: number | null; title: string; full_text_plain: string | null }>();

  const samples = [];
  for (const issue of rows.results) {
    const extracted = extractTopicsMulti(issue.full_text_plain).kept.map(t => t.keyword);
    const storedRows = await c.env.DB.prepare('SELECT keyword FROM issue_topics WHERE issue_id = ? ORDER BY rank LIMIT 25')
      .bind(issue.id).all<{ keyword: string }>();
    const stored = storedRows.results.map(r => r.keyword);
    const overlap = stored.filter(k => extracted.includes(k)).length;
    samples.push({
      issue_id: issue.id,
      issue_number: issue.issue_number,
      title: issue.title,
      extracted_count: extracted.length,
      stored_count: stored.length,
      overlap,
      precision_delta: stored.length === 0 ? null : 1 - overlap / stored.length,
      missing_from_stored: extracted.filter(k => !stored.includes(k)).slice(0, 5),
    });
  }

  return c.json({ samples });
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
