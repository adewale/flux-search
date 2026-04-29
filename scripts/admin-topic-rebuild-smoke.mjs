#!/usr/bin/env node
/**
 * Authenticated production smoke for the topic rebuild + queue pipeline.
 *
 * Usage:
 *   ADMIN_TOKEN=... npm run smoke:admin-topic-rebuild
 *
 * Optional env:
 *   FLUX_BASE_URL=https://...
 *   REBUILD_WAIT_SECONDS=30
 */

const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const token = process.env.ADMIN_TOKEN;
const waitSeconds = Number(process.env.REBUILD_WAIT_SECONDS || 30);
const maxPollSeconds = Number(process.env.QUEUE_POLL_SECONDS || 180);

if (!token) {
  console.error('ADMIN_TOKEN is required. Example: ADMIN_TOKEN=... npm run smoke:admin-topic-rebuild');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${token}` };

async function request(path, opts = {}) {
  const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`${opts.method || 'GET'} ${path} failed: ${res.status}`);
    err.body = body;
    throw err;
  }
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function summarizeRuns(runsBody) {
  const runs = runsBody?.runs || [];
  return runs.slice(0, 5).map(r => ({
    id: r.id,
    mode: r.mode,
    status: r.status,
    started_at: r.started_at,
    completed_at: r.completed_at,
    notes: r.notes,
  }));
}

console.log(JSON.stringify({ event: 'admin_topic_rebuild_smoke_start', base, waitSeconds }, null, 2));

const before = await request('/admin/pipeline-runs?limit=5');
console.log(JSON.stringify({ event: 'before_pipeline_runs', runs: summarizeRuns(before.body) }, null, 2));

const rebuildStartedAt = Date.now();
const rebuild = await request('/admin/rebuild-topics', { method: 'POST' });
console.log(JSON.stringify({
  event: 'rebuild_requested',
  status: rebuild.status,
  elapsed_ms: Date.now() - rebuildStartedAt,
  body: rebuild.body,
}, null, 2));

console.log(JSON.stringify({ event: 'waiting', seconds: waitSeconds }, null, 2));
await sleep(waitSeconds * 1000);

let runs = await request('/admin/pipeline-runs?limit=5');
let latestRun = runs.body?.runs?.[0];
let jobs = null;
let jobRows = [];
const pollStarted = Date.now();
if (latestRun?.id) {
  do {
    runs = await request('/admin/pipeline-runs?limit=5');
    latestRun = runs.body?.runs?.find(r => r.id === latestRun.id) || runs.body?.runs?.[0];
    if (latestRun?.status === 'completed') {
      jobs = await request(`/admin/pipeline-runs/${latestRun.id}/jobs?limit=500`);
      jobRows = jobs?.body?.jobs || [];
      const active = jobRows.filter(j => ['queued', 'processing', 'deferred'].includes(j.status));
      if (jobRows.length > 0 && active.length === 0) break;
    }
    if (latestRun?.status === 'failed') break;
    if (Date.now() - pollStarted >= maxPollSeconds * 1000) break;
    await sleep(5000);
  } while (true);
}

const [coverage, audit, topics, issue214] = await Promise.all([
  request('/admin/coverage'),
  request('/admin/topic-audit?limit=10'),
  fetch(base + '/topics?limit=5').then(r => r.json()),
  fetch(base + '/issues/issue/214/sections').then(r => r.json()),
]);

const jobsByStatus = jobRows.reduce((acc, j) => {
  acc[j.status] = (acc[j.status] || 0) + 1;
  return acc;
}, {});

const failures = [];
if ((topics.topics?.length || 0) === 0) failures.push('No corpus topics visible at /topics');
if ((issue214.topics?.length || 0) === 0) failures.push('Issue #214 has no topics');
if ((issue214.related_issues?.length || 0) === 0) failures.push('Issue #214 has no related_issues');
if (!latestRun || latestRun.status !== 'completed') failures.push('Latest pipeline run did not complete after polling');
if (jobRows.length === 0) failures.push('No queue jobs found for latest pipeline run');
if (jobRows.some(j => j.status === 'failed')) failures.push('Some pipeline jobs failed');
if (jobRows.some(j => ['queued', 'processing', 'deferred'].includes(j.status))) failures.push('Some pipeline jobs are still active after polling');

const report = {
  event: 'admin_topic_rebuild_smoke_result',
  ok: failures.length === 0,
  failures,
  latest_run: latestRun ? {
    id: latestRun.id,
    mode: latestRun.mode,
    status: latestRun.status,
    started_at: latestRun.started_at,
    completed_at: latestRun.completed_at,
    notes: latestRun.notes,
  } : null,
  jobs_count: jobRows.length,
  jobs_by_status: jobsByStatus,
  coverage: coverage.body,
  topic_audit_sample_count: audit.body?.samples?.length ?? null,
  public_surfaces: {
    topics_count: topics.topics?.length ?? 0,
    top_topics: (topics.topics || []).map(t => t.keyword),
    issue_214_topic_count: issue214.topics?.length ?? 0,
    issue_214_related_count: issue214.related_issues?.length ?? 0,
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
