import { describe, it, expect } from 'vitest';
import { normalizePage } from '../src/lib/normalizer';
import { htmlToSimpleMarkdown, extractMetadata } from '../src/crawler/crawl-client';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const RAW_DIR = join(__dirname, '..', 'data', 'raw');

// Substack crud patterns that should never appear in cleaned output
const CRUD_PATTERNS = [
  { name: 'Collection notice', pattern: /Collection notice/i },
  { name: 'Start your Substack', pattern: /Start your Substack/i },
  { name: 'Get the app', pattern: /\bGet the app\b/i },
  { name: 'Substack is the home', pattern: /Substack is the home/i },
  { name: 'enable-javascript', pattern: /enable-javascript\.com/i },
  { name: 'ReplyShare', pattern: /ReplyShare/i },
  { name: 'TopLatestDiscussions', pattern: /TopLatest/i },
  { name: 'NShare (inline)', pattern: /\d{2,}Share/i },
  { name: 'Subscribe (standalone)', pattern: /^\s*Subscribe\*?\s*$/m },
  { name: 'Available at read.fluxcollective', pattern: /Available at\s+\[?read\.fluxcollective/i },
  { name: 'ragtag band', pattern: /ragtag band/i },
  { name: 'Contributors to this issue', pattern: /Contributors?\s+to\s+this\s+issue/i },
  { name: 'Additional insights from', pattern: /Additional\s+insights?\s+from/i },
  { name: 'substack.com/profile/', pattern: /substack\.com\/profile\//i },
  { name: 'open.substack.com', pattern: /open\.substack\.com/i },
  { name: 'N more comments', pattern: /\d+\s+more\s+comments?/i },
  { name: 'Liked by', pattern: /Liked by\s+\w/i },
  { name: 'Empty heading', pattern: /^#{1,6}\s*$/m },
  { name: 'Episode N dateline', pattern: /^Episode\s+\d+\s*[-–—]/m },
  { name: 'FLUX Review site header', pattern: /^The FLUX Review$/m },
  { name: 'FLUX Review Ep. line', pattern: /The FLUX Review,?\s*Ep\.\s*\d+/i },
  { name: 'Photo credit', pattern: /\/\/\s*Photo:/i },
  { name: 'FCP image prompt', pattern: /FCP-\d+/i },
  { name: 'Byline orphan commas', pattern: /^[,\s]+and\s+\d+\s+others/m },
];

describe('corpus crud validation', () => {
  let files: string[];

  try {
    files = readdirSync(RAW_DIR).filter(f => f.endsWith('.html')).sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    it.skip('no raw corpus files found', () => {});
    return;
  }

  it(`processes all ${files.length} issues without crud in plain text`, () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const metadata = extractMetadata(html);

      const result = normalizePage({ url: `https://read.fluxcollective.org/p/${file}`, markdown, metadata }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const plain = result.issue.full_text_plain;

      for (const { name, pattern } of CRUD_PATTERNS) {
        if (pattern.test(plain)) {
          const match = plain.match(pattern);
          failures.push(`${file}: "${name}" found — ${match?.[0]?.slice(0, 60)}`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`Crud found in ${failures.length} places:\n${failures.join('\n')}`);
    }
  });

  it(`processes all ${files.length} issues without crud in markdown`, () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const metadata = extractMetadata(html);

      const result = normalizePage({ url: `https://read.fluxcollective.org/p/${file}`, markdown, metadata }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const md = result.issue.full_text_markdown;

      // Check markdown-specific patterns (links survive in markdown)
      const mdPatterns = CRUD_PATTERNS.filter(p =>
        !['substack.com/profile/', 'open.substack.com'].includes(p.name) || true
      );

      for (const { name, pattern } of mdPatterns) {
        if (pattern.test(md)) {
          const match = md.match(pattern);
          failures.push(`${file}: "${name}" in markdown — ${match?.[0]?.slice(0, 60)}`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`Crud found in ${failures.length} places:\n${failures.join('\n')}`);
    }
  });
});
