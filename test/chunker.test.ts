import { describe, it, expect } from 'vitest';
import { chunkIssue } from '../src/lib/chunker';

describe('chunkIssue', () => {
  it('creates a title_summary chunk as chunk 0', () => {
    const chunks = chunkIssue('issue-1', 'My Title', 'A summary', null);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].section_label).toBe('title_summary');
    expect(chunks[0].chunk_text).toContain('My Title');
    expect(chunks[0].chunk_text).toContain('A summary');
  });

  it('creates body chunks from markdown', () => {
    const body = '## Section One\n\nSome content here about topic A.\n\n## Section Two\n\nMore content about topic B.';
    const chunks = chunkIssue('issue-1', 'Title', 'Summary', body);

    expect(chunks.length).toBeGreaterThanOrEqual(2); // title_summary + at least 1 body
    expect(chunks[0].section_label).toBe('title_summary');
    // Body chunks should exist
    const bodyChunks = chunks.filter(c => c.section_label !== 'title_summary');
    expect(bodyChunks.length).toBeGreaterThan(0);
  });

  it('respects section boundaries', () => {
    const body = '## First Section\n\nContent for first.\n\n## Second Section\n\nContent for second.';
    const chunks = chunkIssue('issue-1', 'Title', null, body);

    const labels = chunks.map(c => c.section_label);
    expect(labels[0]).toBe('title_summary');
    // Should have at least one section-labeled chunk
    expect(labels.some(l => l !== 'title_summary')).toBe(true);
  });

  it('splits long sections into multiple chunks', () => {
    // Create a section longer than MAX_CHUNK_CHARS (3200)
    const longParagraph = 'Word '.repeat(1000); // ~5000 chars
    const body = `## Long Section\n\n${longParagraph}`;
    const chunks = chunkIssue('issue-1', 'Title', null, body);

    const bodyChunks = chunks.filter(c => c.section_label !== 'title_summary');
    expect(bodyChunks.length).toBeGreaterThan(1);
  });

  it('sets chunk IDs with issue ID prefix', () => {
    const chunks = chunkIssue('abc-123', 'Title', 'Summary', 'Body text');
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^abc-123-chunk-\d+$/);
      expect(chunk.issue_id).toBe('abc-123');
    }
  });

  it('estimates token count', () => {
    const chunks = chunkIssue('issue-1', 'Hello World', null, null);
    expect(chunks[0].token_estimate).toBeGreaterThan(0);
    // ~11 chars / 4 ≈ 3 tokens
    expect(chunks[0].token_estimate).toBeLessThan(10);
  });

  it('handles null summary', () => {
    const chunks = chunkIssue('issue-1', 'Title Only', null, null);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunk_text).toBe('Title Only');
  });

  it('handles empty body', () => {
    const chunks = chunkIssue('issue-1', 'Title', 'Summary', '');
    expect(chunks).toHaveLength(1); // just title_summary
  });
});
