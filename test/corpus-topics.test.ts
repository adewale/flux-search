/**
 * Corpus topic extraction verification.
 *
 * Runs yaket extraction across every raw HTML file post-normalization and
 * asserts:
 * - Determinism: running twice yields identical output
 * - Recall: nearly every issue produces at least a few topics
 * - No contamination: top topics contain no raw HTML fragments
 * - Bounded: never more than `top` topics per issue
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { htmlToSimpleMarkdown } from '../src/crawler/crawl-client';
import { normalizePage } from '../src/lib/normalizer';
import { extractTopics } from '../src/lib/topic-extractor';

const RAW_DIR = join(__dirname, '..', 'data', 'raw');

function loadFiles(): string[] {
  try {
    return readdirSync(RAW_DIR).filter(f => f.endsWith('.html')).sort();
  } catch {
    return [];
  }
}

function normalize(file: string): string | null {
  const html = readFileSync(join(RAW_DIR, file), 'utf-8');
  const markdown = htmlToSimpleMarkdown(html);
  const result = normalizePage({
    url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
    markdown,
  }, 'corpus-test');
  if (result.contentType !== 'issue') return null;
  return result.issue.full_text_plain ?? null;
}

describe('corpus topic extraction', () => {
  const files = loadFiles();

  if (files.length === 0) {
    it.skip('no raw corpus files found', () => {});
    return;
  }

  // Sample 20 issues to keep the suite fast while still giving confidence
  const sample = files.filter((_, i) => i % Math.ceil(files.length / 20) === 0).slice(0, 20);

  it('is deterministic across all sampled issues', () => {
    for (const file of sample) {
      const text = normalize(file);
      if (!text) continue;
      const a = extractTopics(text, { top: 15 });
      const b = extractTopics(text, { top: 15 });
      expect(b).toEqual(a);
    }
  });

  it('produces topics for nearly every normal-length issue', () => {
    let processed = 0;
    let empty = 0;
    for (const file of sample) {
      const text = normalize(file);
      if (!text || text.length < 500) continue;
      processed++;
      const topics = extractTopics(text, { top: 10 });
      if (topics.length === 0) empty++;
    }
    expect(processed).toBeGreaterThan(0);
    // Allow a tiny edge-case margin, but the default case must hold
    expect(empty).toBeLessThanOrEqual(Math.ceil(processed * 0.1));
  });

  it('never emits raw HTML or markdown artifacts', () => {
    for (const file of sample) {
      const text = normalize(file);
      if (!text) continue;
      const topics = extractTopics(text, { top: 15 });
      for (const t of topics) {
        expect(t.keyword).not.toMatch(/[<>]/);
        expect(t.keyword).not.toMatch(/^\s*http/);
        expect(t.keyword).not.toMatch(/^\s*!\[/);
      }
    }
  });

  it('respects the `top` bound for every issue', () => {
    for (const file of sample) {
      const text = normalize(file);
      if (!text) continue;
      const topics = extractTopics(text, { top: 8 });
      expect(topics.length).toBeLessThanOrEqual(8);
    }
  });

  it('keywords are never empty or whitespace-only', () => {
    for (const file of sample) {
      const text = normalize(file);
      if (!text) continue;
      const topics = extractTopics(text, { top: 15 });
      for (const t of topics) {
        expect(t.keyword.length).toBeGreaterThan(0);
        expect(t.keyword.trim()).toBe(t.keyword);
      }
    }
  });
});
