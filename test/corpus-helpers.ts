import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToSimpleMarkdown, extractMetadata } from '../src/crawler/crawl-client';
import { normalizePage } from '../src/lib/normalizer';
import type { IssueRow } from '../src/db/types';

const RAW_DIR = join(__dirname, '..', 'data', 'raw');

let byNumberCache: Map<number, IssueRow> | null = null;

/**
 * Process the checked-in raw HTML corpus (data/raw/) through the production
 * crawl + normalize pipeline and index the resulting issues by number.
 *
 * Tests use this instead of reading the generated data/processed/ directory,
 * which is gitignored — depending on it made `npm test` fail on a fresh
 * clone unless `npm run corpus:process` had been run first. Processing the
 * raw corpus directly also exercises the same converter the crawler uses,
 * so tests can't drift from production behavior.
 *
 * Memoized: the corpus is processed at most once per test process.
 */
export function loadCorpusIssuesByNumber(): Map<number, IssueRow> {
  if (byNumberCache) return byNumberCache;

  const map = new Map<number, IssueRow>();
  for (const file of readdirSync(RAW_DIR).filter(f => f.endsWith('.html')).sort()) {
    const html = readFileSync(join(RAW_DIR, file), 'utf-8');
    const result = normalizePage({
      url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
      markdown: htmlToSimpleMarkdown(html),
      metadata: extractMetadata(html),
    }, 'corpus-test');
    if (result.contentType !== 'issue' || result.issue.issue_number == null) continue;
    map.set(result.issue.issue_number, result.issue);
  }

  byNumberCache = map;
  return map;
}
