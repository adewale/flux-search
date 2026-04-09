import type { Env } from '../env';
import { discoverAllIssueUrls } from '../crawler/sitemap-parser';
import { fetchPage } from '../crawler/crawl-client';
import { ingestPage } from '../crawler/ingestor';
import { getAllSourceUrls, createCrawlRun, updateCrawlRun } from '../db/queries';

const MAX_NEW_EPISODES_PER_RUN = 20;

export async function weeklySync(controller: ScheduledController, env: Env): Promise<void> {
  const runId = crypto.randomUUID();
  console.log(`Weekly sync started: ${runId} (cron: ${controller.cron})`);

  await createCrawlRun(env.DB, {
    id: runId,
    seed_url: 'https://read.fluxcollective.org/sitemap.xml',
    mode: 'weekly_sync',
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'running',
    records_found: 0,
    issues_created: 0,
    issues_updated: 0,
    issues_skipped: 0,
    notes: null,
  });

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

    await updateCrawlRun(env.DB, runId, {
      completed_at: new Date().toISOString(),
      status: failed > 0 ? 'partial' : 'completed',
      issues_created: created,
      notes: [
        `Processed ${toProcess.length} of ${missing.length} missing episodes`,
        errors.length > 0 ? `Errors: ${errors.slice(0, 5).join('; ')}` : null,
      ].filter(Boolean).join('. '),
    });

    console.log(`Weekly sync complete: ${created} created, ${failed} failed`);
  } catch (err) {
    console.error('Weekly sync failed:', err);
    await updateCrawlRun(env.DB, runId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      notes: String(err),
    });
  }
}
