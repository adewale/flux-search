#!/usr/bin/env node
const mode = process.argv[2] || 'inline';
const base = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';
const [topics, issue] = await Promise.all([
  fetch(base + '/topics?limit=20').then(r => r.json()),
  fetch(base + '/issues/issue/214/sections').then(r => r.json()),
]);
console.log(JSON.stringify({
  mode,
  captured_at: new Date().toISOString(),
  topics_count: topics.topics?.length ?? 0,
  top_topics: (topics.topics ?? []).slice(0, 10).map(t => t.keyword),
  issue_214_topics: (issue.topics ?? []).map(t => t.keyword),
  issue_214_related: (issue.related_issues ?? []).map(r => r.issue_number),
}, null, 2));
