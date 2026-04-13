/**
 * Corpus chunk and section verification.
 *
 * Processes every raw HTML file through the full pipeline (HTML → markdown →
 * normalize → parse sections → chunk) and verifies:
 * - Every chunk has a valid ChunkLabel
 * - Every parsed section has a valid DisplaySection type
 * - No chunk label leaks past the toDisplaySection boundary
 * - Section structure is consistent across all issues
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { htmlToSimpleMarkdown } from '../src/crawler/crawl-client';
import { normalizePage } from '../src/lib/normalizer';
import { parseSections, DISPLAY_SECTIONS, CHUNK_LABELS, toDisplaySection, type DisplaySection, type ChunkLabel } from '../src/lib/sections';
import { chunkIssue } from '../src/lib/chunker';

const RAW_DIR = join(__dirname, '..', 'data', 'raw');
const displaySet = new Set<string>(DISPLAY_SECTIONS);
const chunkSet = new Set<string>(CHUNK_LABELS);

describe('corpus chunk and section verification', () => {
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

  it(`every issue's parsed sections have valid DisplaySection types`, () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const sections = parseSections(result.issue.full_text_markdown);
      for (const section of sections) {
        if (!displaySet.has(section.type)) {
          failures.push(`${file}: section type "${section.type}" is not a valid DisplaySection`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`Invalid section types found:\n${failures.join('\n')}`);
    }
  });

  it(`every issue's chunks have valid ChunkLabels`, () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const chunks = chunkIssue(
        result.issue.id,
        result.issue.title,
        result.issue.summary,
        result.issue.full_text_markdown
      );

      for (const chunk of chunks) {
        if (!chunkSet.has(chunk.section_label)) {
          failures.push(`${file}: chunk label "${chunk.section_label}" is not a valid ChunkLabel`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`Invalid chunk labels found:\n${failures.join('\n')}`);
    }
  });

  it('every chunk label maps to a valid DisplaySection via toDisplaySection', () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const chunks = chunkIssue(
        result.issue.id,
        result.issue.title,
        result.issue.summary,
        result.issue.full_text_markdown
      );

      for (const chunk of chunks) {
        const display = toDisplaySection(chunk.section_label);
        if (!displaySet.has(display)) {
          failures.push(`${file}: toDisplaySection("${chunk.section_label}") = "${display}" is not a valid DisplaySection`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`toDisplaySection produced invalid output:\n${failures.join('\n')}`);
    }
  });

  it('every issue has at least 2 chunks', () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const chunks = chunkIssue(
        result.issue.id,
        result.issue.title,
        result.issue.summary,
        result.issue.full_text_markdown
      );

      if (chunks.length < 2) {
        failures.push(`${file}: only ${chunks.length} chunk(s) — expected at least title_summary + 1 body chunk`);
      }
    }

    if (failures.length > 0) {
      expect.fail(`Issues with too few chunks:\n${failures.join('\n')}`);
    }
  });

  it('first chunk of every issue is title_summary', () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const chunks = chunkIssue(
        result.issue.id,
        result.issue.title,
        result.issue.summary,
        result.issue.full_text_markdown
      );

      if (chunks[0]?.section_label !== 'title_summary') {
        failures.push(`${file}: first chunk is "${chunks[0]?.section_label}", expected "title_summary"`);
      }
    }

    if (failures.length > 0) {
      expect.fail(`Issues with wrong first chunk:\n${failures.join('\n')}`);
    }
  });

  it('no chunk has empty text', () => {
    const failures: string[] = [];

    for (const file of files) {
      const html = readFileSync(join(RAW_DIR, file), 'utf-8');
      const markdown = htmlToSimpleMarkdown(html);
      const result = normalizePage({
        url: `https://read.fluxcollective.org/p/${file.replace('.html', '')}`,
        markdown,
        metadata: {},
      }, 'run-1');
      if (result.contentType !== 'issue') continue;

      const chunks = chunkIssue(
        result.issue.id,
        result.issue.title,
        result.issue.summary,
        result.issue.full_text_markdown
      );

      for (let i = 0; i < chunks.length; i++) {
        // title_summary chunks can be short (just the title if no summary)
        var minLen = chunks[i].section_label === 'title_summary' ? 3 : 10;
        if (!chunks[i].chunk_text || chunks[i].chunk_text.trim().length < minLen) {
          failures.push(`${file}: chunk ${i} (${chunks[i].section_label}) has empty or near-empty text`);
        }
      }
    }

    if (failures.length > 0) {
      expect.fail(`Chunks with empty text:\n${failures.join('\n')}`);
    }
  });
});
