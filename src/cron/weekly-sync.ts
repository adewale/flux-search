import type { Env } from '../env';
import { discoverAllIssueUrls } from '../crawler/sitemap-parser';
import { fetchPage } from '../crawler/crawl-client';
import { ingestPage } from '../crawler/ingestor';
import { getAllSourceUrls, startCrawlRun, updateCrawlRun } from '../db/queries';
import { rebuildAllTopics } from '../lib/topic-rebuild';
import { enqueueCorpusTopicEmbedding } from '../jobs/enrichment-queue';

const MAX_NEW_EPISODES_PER_RUN = 20;

export async function weeklySync(controller: ScheduledController, env: Env): Promise<void> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  // Wide event log line — single canonical form so downstream tooling
  // can grep `event=`.
  console.log(JSON.stringify({
    event: 'weekly_sync_start', run_id: runId, cron: controller.cron,
  }));

  await startCrawlRun(env.DB, runId, 'weekly_sync', 'https://read.fluxcollective.org/sitemap.xml');

  try {
    // Discover current sitemap URLs
    const sitemapEntries = await discoverAllIssueUrls();

    // Get existing URLs from D1
    const existingUrls = new Set(await getAllSourceUrls(env.DB));

    // Find missing URLs
    const missing = sitemapEntries.filter(e => !existingUrls.has(e.loc));
    console.log(`Weekly sync: ${missing.length} new episodes found out of ${sitemapEntries.length} total`);

    await updateCrawlRun(env.DB, runId, { records_found: missing.length });

    if (missing.length === 0) {
      await updateCrawlRun(env.DB, runId, {
        completed_at: new Date().toISOString(),
        status: 'completed',
        notes: 'No new episodes found',
      });
      return;
    }

    // Bound the work per run
    const toProcess = missing.slice(0, MAX_NEW_EPISODES_PER_RUN);
    let created = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of toProcess) {
      try {
        const page = await fetchPage(entry.loc);
        if (!page) {
          failed++;
          errors.push(`Failed to fetch: ${entry.loc}`);
          continue;
        }

        const result = await ingestPage(env, page, runId);
        if (result === 'created') created++;
      } catch (err) {
        console.error(`Weekly sync failed for ${entry.loc}:`, err);
        failed++;
        errors.push(`${entry.loc}: ${String(err)}`);
      }
    }

    let topicNote: string | null = null;
    if (created > 0) {
      const stats = await rebuildAllTopics(env.DB);
      const queued = await enqueueCorpusTopicEmbedding(env, runId);
      topicNote = `Topic rebuild: ${stats.corpus_topics} corpus topics; queued ${queued} embedding batches`;
    }

    await updateCrawlRun(env.DB, runId, {
      completed_at: new Date().toISOString(),
      status: failed > 0 ? 'partial' : 'completed',
      issues_created: created,
      notes: [
        `Processed ${toProcess.length} of ${missing.length} missing episodes`,
        topicNote,
        errors.length > 0 ? `Errors: ${errors.slice(0, 5).join('; ')}` : null,
      ].filter(Boolean).join('. '),
    });

    console.log(JSON.stringify({
      event: 'weekly_sync_complete', run_id: runId,
      elapsed_ms: Date.now() - startedAt,
      processed: toProcess.length, created, failed,
      total_missing: missing.length,
    }));
  } catch (err) {
    console.error(JSON.stringify({
      event: 'weekly_sync_failed', run_id: runId,
      elapsed_ms: Date.now() - startedAt,
      error: String(err),
    }));
    await updateCrawlRun(env.DB, runId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      notes: String(err),
    });
  }
}
