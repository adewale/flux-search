export type PipelineJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'deferred';

export interface PipelineJobRow {
  id: string;
  run_id: string;
  kind: string;
  semantic_key: string;
  status: PipelineJobStatus;
  payload_json: string;
  attempts: number;
  correlation_id: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

function sha256Hex(input: string): string {
  // FNV-1a fallback for tests/Workers code paths where sync WebCrypto is not
  // available. Idempotency only needs a stable compact key, not secrecy.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stableKeywordKey(kind: string, keywords: string[]): string {
  const normalized = [...new Set(keywords.map(k => k.trim().toLowerCase()).filter(Boolean))].sort();
  return `${kind}:${sha256Hex(normalized.join('\n'))}`;
}

export function idempotencyKeyForMessage(message: { kind?: string; type?: string; keywords?: string[]; issueId?: string; contentHash?: string | null }): string {
  const kind = message.kind ?? message.type;
  if (kind === 'embed-corpus-topics' || kind === 'aggregate-topic-slice') {
    return stableKeywordKey(kind, message.keywords ?? []);
  }
  if (kind === 'rebuild-issue-topics') {
    return `rebuild-issue-topics:${message.issueId}:${message.contentHash ?? 'no-hash'}`;
  }
  return `${kind ?? 'unknown'}:${sha256Hex(JSON.stringify(message))}`;
}

export async function createPipelineJob(
  db: D1Database,
  job: {
    id: string;
    runId: string;
    kind: string;
    semanticKey: string;
    payload: unknown;
    correlationId: string;
    queuedAt: string;
  },
): Promise<boolean> {
  try {
    await db.prepare(`
      INSERT INTO pipeline_jobs
        (id, run_id, kind, semantic_key, status, payload_json, attempts, correlation_id, queued_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?)
    `).bind(
      job.id,
      job.runId,
      job.kind,
      job.semanticKey,
      JSON.stringify(job.payload),
      job.correlationId,
      job.queuedAt,
    ).run();
    return true;
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) return false;
    throw err;
  }
}

export async function claimPipelineJob(db: D1Database, jobId: string, attempts: number, now = new Date().toISOString()): Promise<boolean> {
  const current = await db.prepare('SELECT status FROM pipeline_jobs WHERE id = ?')
    .bind(jobId).first<{ status: PipelineJobStatus }>();
  if (!current) return true; // Legacy/no-row messages are still processable.
  if (current.status === 'succeeded') return false;
  if (!['queued', 'deferred', 'processing'].includes(current.status)) return false;
  await db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'processing', attempts = ?, started_at = COALESCE(started_at, ?), error = NULL
    WHERE id = ?
  `).bind(attempts, now, jobId).run();
  return true;
}

export async function succeedPipelineJob(db: D1Database, jobId: string, now = new Date().toISOString()): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs SET status = 'succeeded', completed_at = ?, error = NULL WHERE id = ?
  `).bind(now, jobId).run();
}

export async function failPipelineJob(db: D1Database, jobId: string, error: unknown, now = new Date().toISOString()): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?
  `).bind(now, String(error), jobId).run();
}

export async function deferPipelineJob(db: D1Database, jobId: string, error: unknown): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs SET status = 'deferred', error = ? WHERE id = ?
  `).bind(String(error), jobId).run();
}

export async function listPipelineJobs(db: D1Database, runId: string, limit = 100): Promise<PipelineJobRow[]> {
  const rows = await db.prepare(`
    SELECT * FROM pipeline_jobs WHERE run_id = ? ORDER BY queued_at DESC LIMIT ?
  `).bind(runId, limit).all<PipelineJobRow>();
  return rows.results;
}
