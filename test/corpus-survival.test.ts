/**
 * Corpus survival test — verifies that the cleaning pipeline preserves
 * legitimate newsletter content. Runs against every raw HTML file in
 * data/raw/, so it automatically covers future issues added to the corpus.
 *
 * This is the complement to corpus-crud.test.ts: that test checks crud
 * is removed, this test checks real content isn't removed.
 */
import { describe, it, expect } from 'vitest';
import { normalizePage } from '../src/lib/normalizer';
import { htmlToSimpleMarkdown, extractMetadata } from '../src/crawler/crawl-client';
import { parseSections } from '../src/lib/sections';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const RAW_DIR = join(__dirname, '..', 'data', 'raw');

interface IssueSummary {
  file: string;
  wordCount: number;
  title: string;
  leadEssay: string | null;
  openingQuote: string | null;
  sectionTypes: string[];
  plainLen: number;
  mdLen: number;
  headingCount: number;
}

function processIssue(file: string): IssueSummary | null {
  const html = readFileSync(join(RAW_DIR, file), 'utf-8');
  const markdown = htmlToSimpleMarkdown(html);
  const metadata = extractMetadata(html);
  const result = normalizePage({
    url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
    markdown,
    metadata,
  }, 'run-1');

  if (result.contentType !== 'issue') return null;

  const sections = parseSections(result.issue.full_text_markdown);
  const headings = (result.issue.full_text_markdown.match(/^#{1,3}\s+.+$/gm) || []);

  return {
    file,
    wordCount: result.issue.word_count,
    title: result.issue.title,
    leadEssay: result.issue.lead_essay_title,
    openingQuote: result.issue.opening_quote,
    sectionTypes: sections.map(s => s.type),
    plainLen: result.issue.full_text_plain.length,
    mdLen: result.issue.full_text_markdown.length,
    headingCount: headings.length,
  };
}

describe('corpus survival', () => {
  let files: string[];
  let issues: IssueSummary[];

  try {
    files = readdirSync(RAW_DIR).filter(f => f.endsWith('.html')).sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    it.skip('no raw corpus files found', () => {});
    return;
  }

  // Process all issues once, share across tests
  issues = files
    .map(f => processIssue(f))
    .filter((s): s is IssueSummary => s !== null);

  it('processes a reasonable number of issues', () => {
    // At least 200 of the 234+ HTML files should be valid issues
    expect(issues.length).toBeGreaterThanOrEqual(200);
  });

  it('every issue has a non-trivial word count', () => {
    const tooShort = issues.filter(s => s.wordCount < 200);
    if (tooShort.length > 0) {
      expect.fail(
        `${tooShort.length} issues have fewer than 200 words:\n` +
        tooShort.map(s => `  ${s.file}: ${s.wordCount} words`).join('\n')
      );
    }
  });

  it('median word count is above 1000', () => {
    const sorted = issues.map(s => s.wordCount).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(1000);
  });

  it('no issue lost more than 60% of its text vs. raw markdown length', () => {
    // The cleaning should remove boilerplate (~10-30%) not the majority of content
    const suspicious = issues.filter(s => s.plainLen < s.mdLen * 0.3);
    if (suspicious.length > 0) {
      expect.fail(
        `${suspicious.length} issues have plain text < 30% of markdown length:\n` +
        suspicious.map(s => `  ${s.file}: plain=${s.plainLen} md=${s.mdLen} (${Math.round(s.plainLen / s.mdLen * 100)}%)`).join('\n')
      );
    }
  });

  it('most issues have a lead essay title', () => {
    const withLead = issues.filter(s => s.leadEssay);
    // At least 90% should have a lead essay title
    expect(withLead.length / issues.length).toBeGreaterThan(0.9);
  });

  it('most issues have an opening quote', () => {
    const withQuote = issues.filter(s => s.openingQuote);
    // At least 85% should have an opening quote
    expect(withQuote.length / issues.length).toBeGreaterThan(0.85);
  });

  it('most issues have 3+ recognized sections', () => {
    const withSections = issues.filter(s => s.sectionTypes.length >= 3);
    // At least 90% should have 3+ sections (lead_essay + signposts + one more)
    expect(withSections.length / issues.length).toBeGreaterThan(0.9);
  });

  it('every issue with sections includes a lead_essay', () => {
    const withSections = issues.filter(s => s.sectionTypes.length >= 1);
    const missingLead = withSections.filter(s => !s.sectionTypes.includes('lead_essay'));
    if (missingLead.length > 0) {
      // Allow a small number of exceptions (special format issues like conversations)
      expect(missingLead.length).toBeLessThan(issues.length * 0.05);
    }
  });

  it('no issue has an empty title', () => {
    const emptyTitle = issues.filter(s => !s.title || s.title.trim().length === 0);
    expect(emptyTitle).toHaveLength(0);
  });

  it('no title contains Substack boilerplate', () => {
    const badTitles = issues.filter(s =>
      /Subscribe|Substack|Collection notice|Privacy.*Terms/i.test(s.title)
    );
    if (badTitles.length > 0) {
      expect.fail(
        `${badTitles.length} issues have boilerplate in title:\n` +
        badTitles.map(s => `  ${s.file}: "${s.title}"`).join('\n')
      );
    }
  });

  it('section distribution looks reasonable across the corpus', () => {
    // Count how often each section type appears
    const counts: Record<string, number> = {};
    for (const issue of issues) {
      for (const type of new Set(issue.sectionTypes)) {
        counts[type] = (counts[type] || 0) + 1;
      }
    }

    // lead_essay should be the most common
    expect(counts['lead_essay']).toBeGreaterThan(issues.length * 0.8);
    // signposts should appear in most issues
    if (counts['signposts']) {
      expect(counts['signposts']).toBeGreaterThan(issues.length * 0.5);
    }
  });

  it('cleaning does not produce empty plain text', () => {
    const empty = issues.filter(s => s.plainLen < 50);
    if (empty.length > 0) {
      expect.fail(
        `${empty.length} issues have near-empty plain text:\n` +
        empty.map(s => `  ${s.file}: ${s.plainLen} chars`).join('\n')
      );
    }
  });

  it('word counts are stable across the corpus (no outlier drops)', () => {
    // Check that no issue has a suspiciously low word count compared to its
    // markdown length — which would indicate the cleaner ate real content
    const ratios = issues.map(s => ({
      file: s.file,
      ratio: s.wordCount / (s.mdLen / 5), // ~5 chars per word
    }));
    const suspicious = ratios.filter(r => r.ratio < 0.3);
    if (suspicious.length > 0) {
      expect.fail(
        `${suspicious.length} issues have word count < 30% of expected:\n` +
        suspicious.map(r => `  ${r.file}: ratio=${r.ratio.toFixed(2)}`).join('\n')
      );
    }
  });
});
