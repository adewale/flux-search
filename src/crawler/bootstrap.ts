import type { Env } from '../env';
import { discoverAllIssueUrls } from './sitemap-parser';
import { fetchPage } from './crawl-client';
import { ingestPage } from './ingestor';
import { createCrawlRun, updateCrawlRun, getAllSourceUrls } from '../db/queries';

const CONCURRENCY = 5;
const DELAY_BETWEEN_FETCHES_MS = 500;
const BATCH_SIZE = 50; // Process at most 50 issues per invocation

export interface BatchPlan {
  toProcess: string[];
  remaining: number;
  done: boolean;
}

/**
 * Pure function: compute which URLs to process in this batch.
 * Testable without any Cloudflare bindings.
 */
export function computeBatchPlan(
  discovered: string[],
  existing: Set<string>,
  batchSize: number
): BatchPlan {
  const missing = discovered.filter(url => !existing.has(url));

  if (missing.length === 0) {
    return { toProcess: [], remaining: 0, done: true };
  }

  const toProcess = missing.slice(0, batchSize);
  const remaining = missing.length - toProcess.length;

  return { toProcess, remaining, done: false };
}

/**
 * Self-continuing bootstrap: processes one batch, then calls itself
 * for the next batch if work remains. No manual re-triggering needed.
 */
export async function runBootstrap(env: Env, crawlRunId: string): Promise<void> {
  console.log(`Starting bootstrap crawl: ${crawlRunId}`);

  await createCrawlRun(env.DB, {
    id: crawlRunId,
    seed_url: 'https://read.fluxcollective.org/sitemap.xml',
    mode: 'bootstrap',
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
    const entries = await discoverAllIssueUrls();
    const discoveredUrls = entries.map(e => e.loc);
    console.log(`Discovered ${entries.length} issue URLs`);

    await updateCrawlRun(env.DB, crawlRunId, { records_found: entries.length });

    // Determine what to process this batch
    const existingUrls = new Set(await getAllSourceUrls(env.DB));
    const plan = computeBatchPlan(discoveredUrls, existingUrls, BATCH_SIZE);

    if (plan.done) {
      await updateCrawlRun(env.DB, crawlRunId, {
        completed_at: new Date().toISOString(),
        status: 'completed',
        notes: 'All issues already ingested',
      });
      console.log('Bootstrap: nothing to do, all issues ingested');
      return;
    }

    console.log(`Processing batch of ${plan.toProcess.length}, ${plan.remaining} remaining after this batch`);

    // Process this batch
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < plan.toProcess.length; i += CONCURRENCY) {
      const batch = plan.toProcess.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const page = await fetchPage(url);
          if (!page) return { url, status: 'failed' as const };
          const result = await ingestPage(env, page, crawlRunId);
          return { url, status: result };
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          failed++;
          errors.push(String(result.reason));
          continue;
        }
        switch (result.value.status) {
          case 'created': created++; break;
          case 'updated': updated++; break;
          case 'skipped': skipped++; break;
          case 'failed': failed++; errors.push(`Failed: ${result.value.url}`); break;
        }
      }

      if (i + CONCURRENCY < plan.toProcess.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_FETCHES_MS));
      }
    }

    const batchDone = plan.remaining === 0;
    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: batchDone ? new Date().toISOString() : null,
      status: batchDone ? (failed > 0 ? 'partial' : 'completed') : 'running',
      issues_created: created,
      issues_updated: updated,
      issues_skipped: skipped,
      notes: batchDone
        ? (errors.length > 0 ? `Errors: ${errors.slice(0, 10).join('; ')}` : null)
        : `Batch done: ${created} created. ${plan.remaining} URLs remaining — continuing...`,
    });

    console.log(`Batch complete: ${created} created, ${failed} failed. ${plan.remaining} remaining.`);

    // Self-continue: if there's more work, kick off next batch
    if (!batchDone) {
      const nextRunId = crypto.randomUUID();
      console.log(`Continuing with next batch: ${nextRunId}`);
      await runBootstrap(env, nextRunId);
    }
  } catch (err) {
    console.error('Bootstrap failed:', err);
    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      notes: String(err),
    });
  }
}
