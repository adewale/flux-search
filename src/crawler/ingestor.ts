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
import { startCrawlRun, updateCrawlRun } from '../db/queries';

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
  // Get old chunk IDs before deleting so we can clean up Vectorize
  const oldChunks = await env.DB.prepare('SELECT id FROM issue_chunks WHERE issue_id = ?')
    .bind(issue.id).all<{ id: string }>();
  const oldChunkIds = oldChunks.results.map(r => r.id);

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

    // Delete orphan vectors (old chunks that no longer exist after re-chunking)
    const newChunkIds = new Set(chunks.map(c => c.id));
    const orphanIds = oldChunkIds.filter(id => !newChunkIds.has(id));
    if (orphanIds.length > 0) {
      await env.VECTORIZE.deleteByIds(orphanIds);
    }

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
  await startCrawlRun(env.DB, crawlRunId, 'reindex');

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
