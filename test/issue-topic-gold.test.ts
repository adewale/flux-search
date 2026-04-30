import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractTopicsMulti } from '../src/lib/topic-multi-extract';
import { buildPhraseLexicon } from '../src/lib/pmi-lexicon';

const GOLD: Array<{ issue: number; expected: string[] }> = [
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

function loadIssues(): Map<number, any> {
  const byNumber = new Map<number, any>();
  for (const f of readdirSync('data/processed').filter(f => f.endsWith('.json'))) {
    const issue = JSON.parse(readFileSync(join('data/processed', f), 'utf8'));
    byNumber.set(issue.issue_number, issue);
  }
  return byNumber;
}

function migrationBlocklist(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync('migrations').filter(f => /topic.*blocklist|fragment|phrase/.test(f))) {
    const sql = readFileSync(join('migrations', f), 'utf8');
    for (const m of sql.matchAll(/\('([^']+)',\s*'[^']+'/g)) out.add(m[1]);
  }
  return out;
}

describe('representative issue topic gold set', () => {
  const byNumber = loadIssues();
  const phraseLexicon = buildPhraseLexicon([...byNumber.values()].map(i => i.full_text_plain ?? ''));
  const blocklist = migrationBlocklist();

  for (const row of GOLD) {
    it(`puts at least 3 gold topics in the top 5 for issue ${row.issue}`, () => {
      const issue = byNumber.get(row.issue);
      const top5 = extractTopicsMulti(issue.full_text_plain, { blocklist, phraseLexicon }, { top: 8 })
        .kept.slice(0, 5).map(t => t.keyword);
      const hits = row.expected.filter(keyword => top5.includes(keyword));
      expect({ top5, expected: row.expected, hits }).toEqual(expect.objectContaining({ hits: expect.arrayContaining(hits) }));
      expect(hits.length).toBeGreaterThanOrEqual(3);
    });
  }
});
