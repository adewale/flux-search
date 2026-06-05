import type { Env } from '../env';
import { runStep, shouldRetryError } from '../lib/topic-rebuild';
import { extractTopicsMulti, type MultiExtractedTopic } from '../lib/topic-multi-extract';
import { stemPhrase } from '../lib/porter-stem';
import { filterTopicsByIssueFrequency } from '../lib/topic-cross-issue-filter';
import {
  claimPipelineJob,
  createPipelineJob,
  deferPipelineJob,
  failPipelineJob,
  failPipelineRunIfPresent,
  idempotencyKeyForMessage,
  recordPipelinePhase,
  succeedPipelineJob,
} from '../lib/pipeline-jobs';
import {
  annotateCorpusTopics,
  buildCorpusTopics,
  buildTopicTimeline,
  clusterCorpusTopics,
  getBlocklist,
  getPhraseLexicon,
  rebuildSimilaritiesFromStoredEmbeddings,
  replaceIssueTopics,
  replaceTopicEmbeddings,
} from '../db/topic-queries';

export type EmbedCorpusTopicsMessage = {
  schemaVersion: 1;
  kind: 'embed-corpus-topics';
  /** Legacy producer compatibility. Prefer kind. */
  type?: 'embed-corpus-topics';
  runId: string;
  /** Legacy producer compatibility. Prefer runId. */
  run_id?: string;
  jobId: string;
  correlationId: string;
  queuedAt: string;
  keywords: string[];
};

export type TopicExtractBatchMessage = {
  schemaVersion: 1;
  kind: 'topic-extract-batch';
  runId: string;
  jobId: string;
  correlationId: string;
  queuedAt: string;
  batchIndex: number;
  issueIds: string[];
};

export type TopicFinalizeRebuildMessage = {
  schemaVersion: 1;
  kind: 'topic-finalize-rebuild';
  runId: string;
  jobId: string;
  correlationId: string;
  queuedAt: string;
  expectedExtractJobs: number;
};

export type LegacyEnrichmentMessage = {
  type: 'embed-corpus-topics';
  run_id: string;
  keywords: string[];
};

export type EnrichmentMessage = EmbedCorpusTopicsMessage | TopicExtractBatchMessage | TopicFinalizeRebuildMessage | LegacyEnrichmentMessage;

export interface TopicKeywordRow {
  keyword: string;
}

function randomId(): string {
  return crypto.randomUUID();
}

function messageKind(message: EnrichmentMessage): 'embed-corpus-topics' | 'topic-extract-batch' | 'topic-finalize-rebuild' {
  return ('kind' in message ? message.kind : message.type) as 'embed-corpus-topics' | 'topic-extract-batch' | 'topic-finalize-rebuild';
}

function messageRunId(message: EnrichmentMessage): string {
  return 'runId' in message ? message.runId : message.run_id;
}

function messageJobId(message: EnrichmentMessage): string | null {
  return 'jobId' in message ? message.jobId : null;
}

function messageCorrelationId(message: EnrichmentMessage): string | null {
  return 'correlationId' in message ? message.correlationId : null;
}

export function makeTopicEmbeddingMessages(
  rows: TopicKeywordRow[],
  runId: string,
  batchSize = 25,
  opts: { correlationId?: string; now?: string } = {},
): EmbedCorpusTopicsMessage[] {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('batchSize must be a positive integer');
  }

  const messages: EmbedCorpusTopicsMessage[] = [];
  const correlationId = opts.correlationId ?? randomId();
  const queuedAt = opts.now ?? new Date().toISOString();
  for (let i = 0; i < rows.length; i += batchSize) {
    const keywords = rows.slice(i, i + batchSize).map(row => row.keyword).filter(Boolean);
    if (keywords.length > 0) {
      messages.push({
        schemaVersion: 1,
        kind: 'embed-corpus-topics',
        type: 'embed-corpus-topics',
        runId,
        run_id: runId,
        jobId: randomId(),
        correlationId,
        queuedAt,
        keywords,
      });
    }
  }
  return messages;
}

export async function enqueueTopicRebuild(env: Env, runId: string, issueIds: string[], batchSize = 10): Promise<{ extractJobs: number; finalizeJobs: number }> {
  if (!env.ENRICHMENT_QUEUE) return { extractJobs: 0, finalizeJobs: 0 };
  const correlationId = randomId();
  const queuedAt = new Date().toISOString();
  const messages: TopicExtractBatchMessage[] = [];
  let batchIndex = 0;
  for (let i = 0; i < issueIds.length; i += batchSize) {
    messages.push({
      schemaVersion: 1,
      kind: 'topic-extract-batch',
      runId,
      jobId: randomId(),
      correlationId,
      queuedAt,
      batchIndex: batchIndex++,
      issueIds: issueIds.slice(i, i + batchSize),
    });
  }

  const sendable: TopicExtractBatchMessage[] = [];
  for (const message of messages) {
    const created = await createPipelineJob(env.DB, {
      id: message.jobId,
      runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId,
      queuedAt,
    });
    if (created) sendable.push(message);
  }
  for (let i = 0; i < sendable.length; i += 100) {
    await env.ENRICHMENT_QUEUE.sendBatch(sendable.slice(i, i + 100).map(body => ({ body })));
  }
  // The finalizer is deliberately not published with the extract jobs.
  // Cloudflare Queues do not guarantee publish order, and a retrying early
  // finalizer can exhaust max_retries/DLQ before slower extracts complete.
  // Each extract success calls enqueueTopicFinalizeIfReady(), which provides
  // the durable barrier using pipeline_jobs state.
  return { extractJobs: sendable.length, finalizeJobs: 0 };
}

async function enqueueTopicFinalizeIfReady(env: Env, runId: string, correlationId: string | null): Promise<boolean> {
  if (!env.ENRICHMENT_QUEUE) return false;

  const counts = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM pipeline_jobs
    WHERE run_id = ? AND kind = 'topic-extract-batch'
  `).bind(runId).first<{ total: number; succeeded: number | null; failed: number | null }>();

  const total = counts?.total ?? 0;
  const succeeded = counts?.succeeded ?? 0;
  const failed = counts?.failed ?? 0;
  if (failed > 0) {
    await failPipelineRunIfPresent(env.DB, runId, 'topic rebuild extract batch failed');
    return false;
  }
  if (total === 0 || succeeded < total) return false;

  const queuedAt = new Date().toISOString();
  const message: TopicFinalizeRebuildMessage = {
    schemaVersion: 1,
    kind: 'topic-finalize-rebuild',
    runId,
    jobId: randomId(),
    correlationId: correlationId ?? randomId(),
    queuedAt,
    expectedExtractJobs: total,
  };
  const created = await createPipelineJob(env.DB, {
    id: message.jobId,
    runId,
    kind: message.kind,
    semanticKey: idempotencyKeyForMessage(message),
    payload: message,
    correlationId: message.correlationId,
    queuedAt,
  });
  if (!created) return false;
  await env.ENRICHMENT_QUEUE.sendBatch([{ body: message }]);
  return true;
}

export async function enqueueCorpusTopicEmbedding(env: Env, runId: string, batchSize = 25): Promise<number> {
  if (!env.ENRICHMENT_QUEUE) return 0;

  const rows = await env.DB.prepare(`
    SELECT keyword
    FROM corpus_topics
    ORDER BY aggregate_score DESC
  `).all<TopicKeywordRow>();

  const messages = makeTopicEmbeddingMessages(rows.results, runId, batchSize);
  const sendable: EmbedCorpusTopicsMessage[] = [];
  for (const message of messages) {
    const created = await createPipelineJob(env.DB, {
      id: message.jobId,
      runId,
      kind: message.kind,
      semanticKey: idempotencyKeyForMessage(message),
      payload: message,
      correlationId: message.correlationId,
      queuedAt: message.queuedAt,
    });
    if (created) sendable.push(message);
  }

  for (let i = 0; i < sendable.length; i += 100) {
    await env.ENRICHMENT_QUEUE.sendBatch(
      sendable.slice(i, i + 100).map(body => ({ body }))
    );
  }
  return sendable.length;
}

async function embedTopicKeywords(env: Env, keywords: string[]): Promise<number> {
  if (keywords.length === 0) return 0;
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: keywords });
  if (!('data' in result) || !Array.isArray(result.data)) return 0;
  const embeddings = keywords.map((keyword, i) => ({ keyword, vector: (result.data as number[][])[i] ?? [] }))
    .filter(e => e.vector.length > 0);
  await replaceTopicEmbeddings(env.DB, embeddings);
  await rebuildSimilaritiesFromStoredEmbeddings(env.DB, embeddings.map(e => e.keyword));
  return embeddings.length;
}

async function extractIssueTopicBatch(env: Env, issueIds: string[]): Promise<{ issues: Array<{ issueId: string; topics: MultiExtractedTopic[] }>; suppressed: number }> {
  const [lexicon, blocklist] = await Promise.all([getPhraseLexicon(env.DB), getBlocklist(env.DB)]);
  if (issueIds.length === 0) return { issues: [], suppressed: 0 };
  const rows = await env.DB.prepare(`
    SELECT id, full_text_plain
    FROM issues
    WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(issueIds)).all<{ id: string; full_text_plain: string | null }>();

  let suppressed = 0;
  const issues = rows.results.map(issue => {
    const extracted = extractTopicsMulti(issue.full_text_plain, { phraseLexicon: lexicon, blocklist });
    suppressed += extracted.suppressed.length;
    return { issueId: issue.id, topics: extracted.kept };
  });
  return { issues, suppressed };
}

async function finalizeTopicRebuild(env: Env, runId: string, expectedExtractJobs: number): Promise<{ issueRows: number; corpusTopics: number; timelineRows: number; clusterMerges: number; queuedEmbeddingBatches: number }> {
  const pending = await env.DB.prepare(`
    SELECT COUNT(*) AS c
    FROM pipeline_jobs
    WHERE run_id = ? AND kind = 'topic-extract-batch' AND status != 'succeeded'
  `).bind(runId).first<{ c: number }>();
  if ((pending?.c ?? 0) > 0) throw new Error('temporarily unavailable: waiting for topic extract batches');

  const extractRows = await env.DB.prepare(`
    SELECT result_json FROM pipeline_jobs
    WHERE run_id = ? AND kind = 'topic-extract-batch' AND status = 'succeeded'
    ORDER BY queued_at ASC
  `).bind(runId).all<{ result_json: string | null }>();
  if (extractRows.results.length < expectedExtractJobs) {
    throw new Error('temporarily unavailable: missing topic extract batch results');
  }

  const byIssue = new Map<string, MultiExtractedTopic[]>();
  let suppressed = 0;
  for (const row of extractRows.results) {
    const parsed = row.result_json ? JSON.parse(row.result_json) as { issues?: Array<{ issueId: string; topics: MultiExtractedTopic[] }>; suppressed?: number } : {};
    suppressed += parsed.suppressed ?? 0;
    for (const issue of parsed.issues ?? []) byIssue.set(issue.issueId, issue.topics);
  }
  const crossIssue = filterTopicsByIssueFrequency(byIssue, 2);
  suppressed += crossIssue.suppressedCount;

  let issueRows = 0;
  for (const [issueId, topics] of crossIssue.byIssue.entries()) {
    const rows = topics.map(t => ({ ...t, stem: stemPhrase(t.keyword) }));
    issueRows += rows.length;
    await replaceIssueTopics(env.DB, issueId, rows);
  }

  const corpusTopics = await buildCorpusTopics(env.DB);
  const clusterMerges = await clusterCorpusTopics(env.DB);
  const timelineRows = await buildTopicTimeline(env.DB);
  await annotateCorpusTopics(env.DB);
  const queuedEmbeddingBatches = await enqueueCorpusTopicEmbedding(env, runId);
  await env.DB.prepare(`
    UPDATE pipeline_runs SET completed_at = ?, status = 'completed', notes = ? WHERE id = ?
  `).bind(new Date().toISOString(), JSON.stringify({ run_id: runId, issue_topic_rows: issueRows, corpus_topics: corpusTopics, timeline_rows: timelineRows, cluster_merges: clusterMerges, topics_suppressed: suppressed, queued_embedding_batches: queuedEmbeddingBatches }), runId).run();

  return { issueRows, corpusTopics, timelineRows, clusterMerges, queuedEmbeddingBatches };
}

export async function handleEnrichmentMessage(message: EnrichmentMessage, env?: Env, attempts = 1): Promise<{ embedded: number; extracted?: number; finalized?: boolean }> {
  const kind = messageKind(message);
  const runId = messageRunId(message);
  const jobId = messageJobId(message);
  const correlationId = messageCorrelationId(message);

  if (env && jobId) {
    const claimed = await claimPipelineJob(env.DB, jobId, attempts);
    if (!claimed) return { embedded: 0 };
  }

  try {
    switch (kind) {
      case 'topic-extract-batch': {
        if (!env || !('issueIds' in message)) return { embedded: 0, extracted: 0 };
        const extracted = await runStep('topic_extract_batch', () => extractIssueTopicBatch(env, message.issueIds));
        await recordPipelinePhase(env.DB, {
          runId,
          jobId,
          phase: 'topic_extract_batch',
          status: 'succeeded',
          summary: { issues: extracted.result.issues.length, suppressed: extracted.result.suppressed },
        });
        if (jobId) await succeedPipelineJob(env.DB, jobId, extracted.result);
        await enqueueTopicFinalizeIfReady(env, runId, correlationId);
        return { embedded: 0, extracted: extracted.result.issues.length };
      }
      case 'topic-finalize-rebuild': {
        if (!env || !('expectedExtractJobs' in message)) return { embedded: 0, finalized: false };
        const finalized = await runStep('topic_finalize_rebuild', () => finalizeTopicRebuild(env, runId, message.expectedExtractJobs));
        await recordPipelinePhase(env.DB, {
          runId,
          jobId,
          phase: 'topic_finalize_rebuild',
          status: 'succeeded',
          summary: finalized.result,
        });
        if (jobId) await succeedPipelineJob(env.DB, jobId, finalized.result);
        return { embedded: 0, finalized: true };
      }
      case 'embed-corpus-topics': {
        if (!('keywords' in message)) return { embedded: 0 };
        const embedded = await runStep('embed_corpus_topics', async () => {
          const count = env ? await embedTopicKeywords(env, message.keywords) : message.keywords.length;
          console.log(JSON.stringify({
            event: 'topic_enrichment_job',
            run_id: runId,
            job_id: jobId,
            correlation_id: correlationId,
            kind,
            status: 'succeeded',
            attempts,
            batch_size: message.keywords.length,
            embedded: count,
            ack: true,
          }));
          return count;
        });
        if (env) await recordPipelinePhase(env.DB, {
          runId,
          jobId,
          phase: 'topic_embedding',
          status: 'succeeded',
          summary: { keywords: message.keywords.length, embedded: embedded.result },
        });
        if (env && jobId) await succeedPipelineJob(env.DB, jobId, { embedded: embedded.result });
        return { embedded: embedded.result };
      }
    }
  } catch (err) {
    if (env && jobId) {
      if (shouldRetryError(err)) await deferPipelineJob(env.DB, jobId, err);
      else {
        await failPipelineJob(env.DB, jobId, err);
        if (kind === 'topic-extract-batch') await failPipelineRunIfPresent(env.DB, runId, err);
      }
    }
    throw err;
  }
}

export async function processEnrichmentQueue(batch: MessageBatch<EnrichmentMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const attempts = typeof message.attempts === 'number' ? message.attempts : 1;
    try {
      await handleEnrichmentMessage(message.body, env, attempts);
      message.ack();
    } catch (err) {
      const jobId = messageJobId(message.body);
      if (shouldRetryError(err)) {
        if (jobId) await deferPipelineJob(env.DB, jobId, err);
        message.retry({ delaySeconds: 5 });
      } else {
        if (jobId) await failPipelineJob(env.DB, jobId, err);
        console.error(JSON.stringify({
          event: 'enrichment_message_failed',
          type: message.body && ('kind' in message.body ? message.body.kind : message.body.type),
          job_id: jobId,
          attempts,
          error: String(err),
          ack: true,
        }));
        message.ack();
      }
    }
  }
}
