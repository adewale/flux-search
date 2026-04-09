import type { Env } from '../env';
import type { IssueRow } from '../db/types';
import type { CrawlPageResult } from './crawl-client';
import { normalizePage, computeContentHash } from '../lib/normalizer';
import { checkDuplicate } from '../lib/deduplicator';
import { chunkIssue } from '../lib/chunker';
import { embedChunks, upsertVectors } from '../lib/embedder';
import {
  upsertIssue, insertChunks, deleteChunksByIssueId,
} from '../db/queries';
import { createCrawlRun, updateCrawlRun } from '../db/queries';

/**
 * Ingest a single crawled page into D1 and Vectorize.
 */
export async function ingestPage(
  env: Env,
  page: CrawlPageResult,
  crawlRunId: string
): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
  const normalized = normalizePage(page, crawlRunId);

  if (normalized.contentType !== 'issue') {
    return 'skipped';
  }

  const contentHash = await computeContentHash(normalized.issue.full_text_plain || '');
  normalized.issue.content_hash = contentHash;

  const dedup = await checkDuplicate(
    env.DB,
    normalized.issue.source_url,
    contentHash,
    normalized.issue.issue_number,
    normalized.issue.published_at
  );

  if (dedup.isDuplicate && dedup.existingIssue) {
    if (dedup.existingIssue.content_hash === contentHash) {
      return 'skipped';
    }

    // Content changed — update existing issue
    normalized.issue.id = dedup.existingIssue.id;
    await upsertIssue(env.DB, normalized.issue);
    await rechunkAndEmbed(env, normalized.issue);
    return 'updated';
  }

  // New issue
  await upsertIssue(env.DB, normalized.issue);
  await rechunkAndEmbed(env, normalized.issue);
  return 'created';
}

async function rechunkAndEmbed(env: Env, issue: IssueRow): Promise<void> {
  await deleteChunksByIssueId(env.DB, issue.id);

  const chunks = chunkIssue(
    issue.id,
    issue.title,
    issue.summary,
    issue.full_text_markdown
  );

  for (const chunk of chunks) {
    chunk.content_hash = await computeContentHash(chunk.chunk_text);
  }

  await insertChunks(env.DB, chunks);

  // Embedding is best-effort — AI/Vectorize may be unavailable in local dev
  try {
    const embedded = await embedChunks(env, chunks);
    await upsertVectors(env, embedded, {
      issue_id: issue.id,
      issue_number: issue.issue_number,
      published_at: issue.published_at,
      title: issue.title,
    });
    await env.DB.prepare('UPDATE issues SET has_semantic_chunks = 1 WHERE id = ?')
      .bind(issue.id)
      .run();
  } catch (err) {
    console.error(`Embedding skipped for issue ${issue.id}:`, err);
  }
}

/**
 * Re-chunk and re-embed all existing issues (for reindex operations).
 */
export async function runReindex(env: Env, crawlRunId: string): Promise<void> {
  await createCrawlRun(env.DB, {
    id: crawlRunId,
    seed_url: null,
    mode: 'reindex',
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
    const allIssues = await env.DB.prepare('SELECT * FROM issues WHERE status = ?')
      .bind('active')
      .all<IssueRow>();

    let updated = 0;
    let failed = 0;

    for (const issue of allIssues.results) {
      try {
        await rechunkAndEmbed(env, issue);
        updated++;
      } catch (err) {
        console.error(`Reindex failed for issue ${issue.id}:`, err);
        failed++;
      }
    }

    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: new Date().toISOString(),
      status: failed > 0 ? 'partial' : 'completed',
      records_found: allIssues.results.length,
      issues_updated: updated,
      notes: failed > 0 ? `${failed} issues failed to reindex` : null,
    });
  } catch (err) {
    await updateCrawlRun(env.DB, crawlRunId, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      notes: String(err),
    });
  }
}
