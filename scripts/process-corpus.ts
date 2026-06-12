/**
 * Process raw HTML corpus into normalized JSON records.
 * No network — reads from data/raw/, writes to data/processed/.
 *
 * Usage: npx tsx scripts/process-corpus.ts
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

import { normalizePage, computeContentHash } from '../src/lib/normalizer';
import { parseSections } from '../src/lib/sections';
import { chunkIssue } from '../src/lib/chunker';
import { htmlToSimpleMarkdown, extractMetadata } from '../src/crawler/crawl-client';

const RAW_DIR = 'data/raw';
const PROCESSED_DIR = 'data/processed';

async function main() {
  if (!existsSync(RAW_DIR)) {
    console.error('No raw HTML cache. Run: ./scripts/fetch-corpus.sh');
    process.exit(1);
  }

  mkdirSync(PROCESSED_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR).filter(f => f.endsWith('.html'));
  console.log(`Processing ${files.length} HTML files...`);

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const slug = file.replace('.html', '');
    const html = readFileSync(join(RAW_DIR, file), 'utf-8');
    const url = `https://read.fluxcollective.org/p/${slug}`;

    try {
      const metadata = extractMetadata(html);
      const markdown = htmlToSimpleMarkdown(html);
      const normalized = normalizePage({ url, markdown, metadata }, 'local-process');

      const sections = normalized.issue.full_text_markdown
        ? parseSections(normalized.issue.full_text_markdown)
        : [];

      const chunks = chunkIssue(
        normalized.issue.id,
        normalized.issue.title,
        normalized.issue.summary,
        normalized.issue.full_text_markdown
      );

      const contentHash = await computeContentHash(normalized.issue.full_text_plain || '');

      const record = {
        ...normalized.issue,
        content_hash: contentHash,
        contentType: normalized.contentType,
        sections: sections.map(s => ({ type: s.type, title: s.title })),
        chunk_count: chunks.length,
      };

      writeFileSync(join(PROCESSED_DIR, `${slug}.json`), JSON.stringify(record, null, 2));
      processed++;
    } catch (err) {
      console.error(`  ERROR ${slug}: ${err}`);
      errors++;
    }
  }

  console.log(`\nProcessed: ${processed}, Errors: ${errors}`);
  console.log(`Output: ${PROCESSED_DIR}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
