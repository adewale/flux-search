#!/usr/bin/env node
const BASE = process.env.FLUX_BASE_URL || 'https://flux-search.adewale-883.workers.dev';

const GOLD = [
  { issue: 214, expected: ['zugzwang', 'saddle point', 'systems thinking', 'crypto', 'charlie warzel'] },
  { issue: 229, expected: ['legibility', 'seeing like a state', 'christopher alexander', 'governance', 'climate change'] },
  { issue: 190, expected: ['large language models', 'prompting', 'iteration', 'exploration', 'judgment'] },
  { issue: 150, expected: ['seeing like a state', 'joel spolsky', 'chesterton fence', 'ashley goodall', 'geoffrey litt'] },
  { issue: 122, expected: ['attention', 'awareness', 'legibility', 'crypto', 'machine learning'] },
  { issue: 1, expected: ['southeast asia', 'south asia', 'john oliver', 'farnam street', 'melanie mitchell'] },
  { issue: 25, expected: ['crypto', 'cryptocurrency', 'governance', 'climate change', 'systems thinking'] },
  { issue: 50, expected: ['crypto', 'cryptocurrency', 'climate change', 'mental models', 'systems thinking'] },
  { issue: 75, expected: ['wild problems', 'crypto', 'climate change', 'systems thinking', 'theory of constraints'] },
  { issue: 100, expected: ['systems thinking', 'exploration', 'fritjof capra', 'large language models', 'alan watts'] },
  { issue: 125, expected: ['judgment', 'large language models', 'alex davis', 'functional brain connectivity', 'game stuff'] },
  { issue: 175, expected: ['climate change', 'benedict evans', 'chris argyris', 'scientific american', 'paul krugman'] },
  { issue: 200, expected: ['governance', 'attention', 'venkatesh rao', 'byrne hobart', 'large language models'] },
  { issue: 210, expected: ['large language models', 'north america', 'on slop', 'john david pressman', 'financial times'] },
  { issue: 220, expected: ['east africans', 'seventh party system', 'attention', 'large language models', 'john ganz'] },
  { issue: 225, expected: ['crypto', 'saudi arabia', 'large language models', 'open source', 'andhra pradesh'] },
  { issue: 230, expected: ['strait of hormuz', 'judgment', 'attention', 'governance', 'jevons paradox'] },
  { issue: 180, expected: ['legibility', 'crypto', 'systems thinking', 'albert hirschman', 'david marquet'] },
  { issue: 160, expected: ['judgment', 'iteration', 'systems thinking', 'large language models', 'francis ford coppola'] },
  { issue: 140, expected: ['legibility', 'exploration', 'black mirror', 'emad mostaque', 'david morrison'] },
  { issue: 120, expected: ['steve jobs', 'large language models', 'mental models', 'fall of somali pirates', 'department of education'] },
  { issue: 90, expected: ['crypto', 'large language models', 'machine learning', 'climate change', 'donald shoup'] },
  { issue: 60, expected: ['mental models', 'systems thinking', 'communist party', 'ben reinhardt', 'alain de botton'] },
  { issue: 30, expected: ['plan voisin', 'cryptocurrency', 'crypto', 'attention', 'climate change'] },
  { issue: 202, expected: ['large language models', 'internet archive', 'wayback machine', 'eating the economy', 'paul kedrosky'] },
];

const PROTECTED = ['crypto', 'rest of world', 'not boring', 'crooked timber', 'simple habits for complex times', 'seeing like a state'];
const KNOWN_BAD = ['img src', 'xers highlighting', 'exchange commission', 'many americans', 'secretary of defense rock', 'as treasury', 'good reason you can'];

async function json(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function status(path) {
  const r = await fetch(BASE + path, { headers: { accept: 'text/html' } });
  return { status: r.status, contentType: r.headers.get('content-type') };
}

const topics = (await json('/topics?limit=1000')).topics ?? [];
const topicKeywords = new Set(topics.map(t => t.keyword));

const issueScores = [];
for (const row of GOLD) {
  const issue = await json(`/issues/issue/${row.issue}`);
  const top5 = (issue.topics ?? []).slice(0, 5).map(t => t.keyword);
  const hits = row.expected.filter(k => top5.includes(k));
  issueScores.push({ issue: row.issue, top5, expected: row.expected, hits, hitsAt5: hits.length });
}

const protectedRoutes = {};
for (const k of PROTECTED) protectedRoutes[k] = await status(`/topics/${encodeURIComponent(k)}`);
const badRoutes = {};
for (const k of KNOWN_BAD) badRoutes[k] = await status(`/topics/${encodeURIComponent(k)}`);

const hits = issueScores.map(r => r.hitsAt5);
const report = {
  generated_at: new Date().toISOString(),
  base: BASE,
  corpus: {
    count: topics.length,
    top20: topics.slice(0, 20).map((t, i) => ({ rank: i + 1, keyword: t.keyword, df: t.doc_frequency, score: t.aggregate_score })),
    knownBadPresent: KNOWN_BAD.filter(k => topicKeywords.has(k)),
    protectedPresent: PROTECTED.map(k => ({ keyword: k, present: topicKeywords.has(k), rank: topics.findIndex(t => t.keyword === k) + 1 })),
  },
  issue_gold: {
    issues: issueScores.length,
    averageHitsAt5: hits.reduce((a, b) => a + b, 0) / Math.max(1, hits.length),
    minimumHitsAt5: Math.min(...hits),
    issuesWithAtLeast3: hits.filter(n => n >= 3).length,
    issuesWithAtLeast4: hits.filter(n => n >= 4).length,
    details: issueScores,
  },
  routes: { protectedRoutes, badRoutes },
};
console.log(JSON.stringify(report, null, 2));
