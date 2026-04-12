import type { Env } from '../env';
import { discoverAllIssueUrls } from './sitemap-parser';
import { fetchPage } from './crawl-client';
import { ingestPage } from './ingestor';
import { startCrawlRun, updateCrawlRun, getAllSourceUrls } from '../db/queries';

const CONCURRENCY = 5;
const DELAY_BETWEEN_FETCHES_MS = 500;
const BOOTSTRAP_BATCH_SIZE = 50;

export interface BatchPlan {
  toProcess: string[];
  remaining: number;
  done: boolean;
}

export function computeBatchPlan(
  discovered: string[],
  existing: Set<string>,
  batchSize: number
): BatchPlan {
  const missing = discovered.filter(url => !existing.has(url));
  if (missing.length === 0) return { toProcess: [], remaining: 0, done: true };
  const toProcess = missing.slice(0, batchSize);
  return { toProcess, remaining: missing.length - toProcess.length, done: false };
}

export async function runBootstrap(env: Env, crawlRunId: string, options?: { force?: boolean; offset?: number }): Promise<void> {
  console.log(`Starting bootstrap crawl: ${crawlRunId}`);

  await startCrawlRun(env.DB, crawlRunId, 'bootstrap', 'https://read.fluxcollective.org/sitemap.xml');

  try {
    // Discover once, iterate in batches
    const entries = await discoverAllIssueUrls();
    const discoveredUrls = entries.map(e => e.loc);
    console.log(`Discovered ${entries.length} issue URLs`);

    await updateCrawlRun(env.DB, crawlRunId, { records_found: entries.length });

    let totalCreated = 0;
    let totalFailed = 0;
    const errors: string[] = [];

    // Iterative batch loop — no recursion
    while (true) {
      const existingUrls = new Set(await getAllSourceUrls(env.DB));

      let plan: BatchPlan;
      if (options?.force) {
        const start = options.offset || 0;
        const batch = discoveredUrls.slice(start, start + BOOTSTRAP_BATCH_SIZE);
        plan = { toProcess: batch, remaining: discoveredUrls.length - start - batch.length, done: batch.length === 0 };
      } else {
        plan = computeBatchPlan(discoveredUrls, existingUrls, BOOTSTRAP_BATCH_SIZE);
      }

      if (plan.done) break;

      console.log(`Processing batch of ${plan.toProcess.length}, ${plan.remaining} remaining`);

      for (let i = 0; i < plan.toProcess.length; i += CONCURRENCY) {
        const batch = plan.toProcess.slice(i, i + CONCURRENCY);

        const results = await Promise.allSettled(
          batch.map(async (url) => {
            const page = await fetchPage(url);
            if (!page) return { url, status: 'failed' as const };
            return { url, status: await ingestPage(env, page, crawlRunId, { force: options?.force }) };
          })
        );

        for (const result of results) {
          if (result.status === 'rejected') {
            totalFailed++;
            errors.push(String(result.reason));
          } else if (result.value.status === 'created') {
            totalCreated++;
          } else if (result.value.status === 'failed') {
            totalFailed++;
            errors.push(`Failed: ${result.value.url}`);
          }
        }

        if (i + CONCURRENCY < plan.toProcess.length) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_FETCHES_MS));
        }
      }

      await updateCrawlRun(env.DB, crawlRunId, {
        issues_created: totalCreated,
        notes: `In progress: ${totalCreated} created, ${plan.remaining} URLs remaining`,
      });

      // Force mode processes one batch per invocation
      if (options?.force) break;
    }

    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: new Date().toISOString(),
      status: totalFailed > 0 ? 'partial' : 'completed',
      issues_created: totalCreated,
      notes: errors.length > 0 ? `Errors: ${errors.slice(0, 10).join('; ')}` : null,
    });

    console.log(`Bootstrap complete: ${totalCreated} created, ${totalFailed} failed`);
  } catch (err) {
    console.error('Bootstrap failed:', err);
    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      notes: String(err),
    });
  }
}
