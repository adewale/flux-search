/**
 * Process raw HTML corpus into normalized JSON records.
 * No network — reads from data/raw/, writes to data/processed/.
 *
 * Usage: npx tsx scripts/process-corpus.ts
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Import our pipeline modules
import { fetchPage } from '../src/crawler/crawl-client';
import { normalizePage, computeContentHash } from '../src/lib/normalizer';
import { parseSections } from '../src/lib/sections';
import { chunkIssue } from '../src/lib/chunker';

const RAW_DIR = 'data/raw';
const PROCESSED_DIR = 'data/processed';

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
    // Extract metadata from HTML (same as crawl-client.ts extractMetadata)
    const metadata: Record<string, string> = {};
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) metadata.title = titleMatch[1].trim();

    const metaTagRegex = /<meta\s+([^>]+?)\/?\s*>/gi;
    let tagMatch;
    while ((tagMatch = metaTagRegex.exec(html)) !== null) {
      const attrs = tagMatch[1];
      const nameMatch = attrs.match(/(?:name|property)="([^"]+)"/i);
      const contentMatch = attrs.match(/content="([^"]+)"/i);
      if (nameMatch && contentMatch) {
        metadata[nameMatch[1]] = contentMatch[1];
      }
    }

    // Convert HTML to markdown (same as crawl-client.ts htmlToSimpleMarkdown)
    let text = html;
    text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    text = text.replace(/<(?:strong|b\b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
    text = text.replace(/<(?:em|i\b)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
    text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n');
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
    text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&mdash;/g, '\u2014');
    text = text.replace(/&ndash;/g, '\u2013');
    text = text.replace(/&lsquo;/g, '\u2018');
    text = text.replace(/&rsquo;/g, '\u2019');
    text = text.replace(/&ldquo;/g, '\u201C');
    text = text.replace(/&rdquo;/g, '\u201D');
    text = text.replace(/&hellip;/g, '\u2026');
    text = text.replace(/&bull;/g, '\u2022');
    text = text.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#039;/g, "'");
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

    const markdown = text;

    // Run through our normalizer
    const normalized = normalizePage({ url, markdown, metadata }, 'local-process');

    // Parse sections
    const sections = normalized.issue.full_text_markdown
      ? parseSections(normalized.issue.full_text_markdown)
      : [];

    // Chunk
    const chunks = chunkIssue(
      normalized.issue.id,
      normalized.issue.title,
      normalized.issue.summary,
      normalized.issue.full_text_markdown
    );

    // Content hash
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
