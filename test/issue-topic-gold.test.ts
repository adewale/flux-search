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
