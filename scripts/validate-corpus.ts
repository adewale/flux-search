/**
 * Validate processed corpus against known constraints.
 * Catches errors BEFORE uploading to D1.
 *
 * Usage: npx tsx scripts/validate-corpus.ts
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PROCESSED_DIR = 'data/processed';

const files = readdirSync(PROCESSED_DIR).filter(f => f.endsWith('.json'));
console.log(`Validating ${files.length} records...\n`);

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail: string = '') {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(`${label}: ${detail}`);
  }
}

for (const file of files) {
  const slug = file.replace('.json', '');
  const data = JSON.parse(readFileSync(join(PROCESSED_DIR, file), 'utf-8'));
  const prefix = `#${data.issue_number || slug}`;

  // Date constraints
  if (data.published_at) {
    const year = parseInt(data.published_at.split('-')[0]);
    check(`${prefix} date ≥ 2021`, year >= 2021, `got ${data.published_at}`);
    check(`${prefix} date ≤ 2027`, year <= 2027, `got ${data.published_at}`);
  }

  // Title quality
  check(`${prefix} has title`, !!data.title && data.title !== 'Untitled', `title: ${data.title}`);
  check(`${prefix} title no FLUX boilerplate`, !data.title?.includes('by The FLUX Collective'), `title: ${data.title}`);
  check(`${prefix} title no leading emoji`, !/^[\u{1F000}-\u{1FFFF}]/.test(data.title || ''), `title starts with emoji`);

  // Content quality
  if (data.full_text_plain) {
    check(`${prefix} no substackcdn in plain text`, !data.full_text_plain.includes('substackcdn'), 'substackcdn in plain text');
    check(`${prefix} no bucketeer in plain text`, !data.full_text_plain.includes('bucketeer'), 'bucketeer in plain text');
    check(`${prefix} no [](http in plain text`, !data.full_text_plain.includes('[](http'), '[](http in plain text');
    check(`${prefix} no SubscribeSign in plain text`, !data.full_text_plain.includes('SubscribeSign'), 'SubscribeSign in plain text');
    check(`${prefix} no blockquote markers in plain text`, !data.full_text_plain.includes('\n> '), 'blockquote in plain text');
  }

  if (data.full_text_markdown) {
    check(`${prefix} no substackcdn in markdown`, !data.full_text_markdown.includes('substackcdn'), 'substackcdn in markdown');
    check(`${prefix} no empty links in markdown`, !data.full_text_markdown.includes('[]('), 'empty link in markdown');
  }

  // Section structure
  if (data.sections && data.sections.length > 0) {
    const types = data.sections.map((s: any) => s.type);
    const validTypes = ['lead_essay', 'signposts', 'worth_your_time', 'lens', 'book', 'postcard', 'fluxers', 'other'];
    for (const t of types) {
      check(`${prefix} valid section type: ${t}`, validTypes.includes(t), `unknown type: ${t}`);
    }
  }

  // Issue number
  if (data.issue_number) {
    check(`${prefix} issue_number > 0`, data.issue_number > 0, `issue_number: ${data.issue_number}`);
    check(`${prefix} issue_number ≤ 300`, data.issue_number <= 300, `issue_number: ${data.issue_number}`);
  }

  // Content hash
  check(`${prefix} has content_hash`, !!data.content_hash && data.content_hash.length > 10, 'missing hash');

  // Word count
  if (data.word_count) {
    check(`${prefix} word_count > 50`, data.word_count > 50, `word_count: ${data.word_count}`);
    check(`${prefix} word_count < 50000`, data.word_count < 50000, `word_count: ${data.word_count}`);
  }
}

console.log(`\n${'='.repeat(40)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(40)}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
  process.exit(1);
}
