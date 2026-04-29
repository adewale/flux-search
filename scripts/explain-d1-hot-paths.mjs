#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const remote = process.argv.includes('--remote');
const dbName = process.env.D1_DATABASE || 'flux-search-db';

const queries = [
  {
    name: 'topic-detail-issues',
    sql: `EXPLAIN QUERY PLAN
SELECT i.*
FROM issue_topics it
CROSS JOIN issues i ON i.id = it.issue_id
WHERE it.keyword = 'systems thinking' AND i.status = 'active'
ORDER BY i.published_at DESC`,
  },
  {
    name: 'topic-timeline',
    sql: `EXPLAIN QUERY PLAN
SELECT * FROM topic_timeline
WHERE keyword = 'systems thinking'
ORDER BY year, month`,
  },
  {
    name: 'topic-similarity',
    sql: `EXPLAIN QUERY PLAN
SELECT keyword_b, blended FROM topic_similarity
WHERE keyword_a = 'systems thinking'
ORDER BY blended DESC LIMIT 12`,
  },
  {
    name: 'issue-number',
    sql: `EXPLAIN QUERY PLAN
SELECT * FROM issues
WHERE issue_number = 214 AND status = 'active'`,
  },
  {
    name: 'pipeline-queued-jobs',
    sql: `EXPLAIN QUERY PLAN
SELECT * FROM pipeline_jobs
WHERE status = 'queued' AND next_attempt_at <= '2026-04-29T00:00:00Z'
ORDER BY queued_at LIMIT 10`,
  },
];

const results = [];
for (const query of queries) {
  const args = ['wrangler', 'd1', 'execute', dbName, '--json', '--command', query.sql];
  if (remote) args.splice(4, 0, '--remote');
  const child = spawnSync('npx', args, { encoding: 'utf8' });
  if (child.status !== 0) {
    console.error(child.stderr || child.stdout);
    process.exit(child.status ?? 1);
  }
  const parsed = JSON.parse(child.stdout);
  const plan = parsed.flatMap(r => r.results ?? []).map(r => r.detail).join('\n');
  results.push({ name: query.name, plan });
}

console.log(JSON.stringify({ database: dbName, remote, results }, null, 2));
