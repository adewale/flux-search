export type PipelineJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'deferred';

export interface PipelineJobRow {
  id: string;
  run_id: string;
  kind: string;
  semantic_key: string;
  status: PipelineJobStatus;
  payload_json: string;
  attempts: number;
  attempt_count?: number;
  schema_version?: number;
  result_json?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
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
        (id, run_id, kind, semantic_key, status, payload_json, attempts, attempt_count, schema_version, correlation_id, queued_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, 1, ?, ?, ?)
    `).bind(
      job.id,
      job.runId,
      job.kind,
      job.semanticKey,
      JSON.stringify(job.payload),
      job.correlationId,
      job.queuedAt,
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
    SET status = 'processing', attempts = ?, attempt_count = ?, started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL, last_error = NULL
    WHERE id = ?
  `).bind(attempts, attempts, now, now, jobId).run();
  return true;
}

export async function succeedPipelineJob(db: D1Database, jobId: string, result: unknown = null, now = new Date().toISOString()): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'succeeded', completed_at = ?, finished_at = ?, updated_at = ?, result_json = ?, error = NULL, last_error = NULL
    WHERE id = ?
  `).bind(now, now, now, result == null ? null : JSON.stringify(result), jobId).run();
}

export async function failPipelineJob(db: D1Database, jobId: string, error: unknown, now = new Date().toISOString()): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs
    SET status = 'failed', completed_at = ?, finished_at = ?, updated_at = ?, error = ?, last_error = ?, last_error_kind = 'permanent'
    WHERE id = ?
  `).bind(now, now, now, String(error), String(error), jobId).run();
}

export async function deferPipelineJob(db: D1Database, jobId: string, error: unknown): Promise<void> {
  await db.prepare(`
    UPDATE pipeline_jobs SET status = 'deferred', error = ?, last_error = ?, last_error_kind = 'transient', updated_at = ? WHERE id = ?
  `).bind(String(error), String(error), new Date().toISOString(), jobId).run();
}

export async function getPipelineJob(db: D1Database, jobId: string): Promise<PipelineJobRow | null> {
  return db.prepare('SELECT * FROM pipeline_jobs WHERE id = ?').bind(jobId).first<PipelineJobRow>();
}

export async function listPipelineJobs(db: D1Database, runId: string, limit = 100): Promise<PipelineJobRow[]> {
  const rows = await db.prepare(`
    SELECT * FROM pipeline_jobs WHERE run_id = ? ORDER BY queued_at DESC LIMIT ?
  `).bind(runId, limit).all<PipelineJobRow>();
  return rows.results;
}

export async function recordPipelinePhase(
  db: D1Database,
  input: { runId: string; jobId?: string | null; phase: string; status: 'running' | 'succeeded' | 'failed'; summary?: unknown; error?: unknown },
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO pipeline_phases
      (id, job_id, run_id, name, phase, started_at, completed_at, finished_at, status, elapsed_ms, error, error_count, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    input.jobId ?? input.runId,
    input.runId,
    input.phase,
    input.phase,
    now,
    input.status === 'running' ? null : now,
    input.status === 'running' ? null : now,
    input.status,
    input.error == null ? null : String(input.error),
    input.error == null ? 0 : 1,
    input.summary == null ? null : JSON.stringify(input.summary),
  ).run();
}

export async function activeDuplicateCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT semantic_key FROM pipeline_jobs
      WHERE status IN ('queued', 'processing', 'deferred')
      GROUP BY semantic_key HAVING COUNT(*) > 1
    )
  `).first<{ c: number }>();
  return row?.c ?? 0;
}
