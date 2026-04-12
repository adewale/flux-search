import { describe, it, expect } from 'vitest';
import { normalizePage, computeContentHash } from '../src/lib/normalizer';

describe('normalizePage', () => {
  it('classifies /p/ URLs as issues', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/flux-review-198',
      markdown: '# FLUX Review #198\n\n' + 'Content here. '.repeat(20),
    }, 'run-1');

    expect(result.contentType).toBe('issue');
  });

  it('classifies short /p/ pages as junk', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/some-page',
      markdown: 'Short',
    }, 'run-1');

    expect(result.contentType).toBe('junk');
  });

  it('classifies archive pages as non_issue_post', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/archive',
      markdown: 'Archive content '.repeat(50),
    }, 'run-1');

    expect(result.contentType).toBe('non_issue_post');
  });

  it('extracts issue number from URL', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/flux-review-198-some-title',
      markdown: '# Some Title\n\n' + 'Content. '.repeat(30),
    }, 'run-1');

    expect(result.issue.issue_number).toBe(198);
  });

  it('extracts issue number from markdown title', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/some-slug',
      markdown: '# FLUX Review #42\n\n' + 'Content. '.repeat(30),
    }, 'run-1');

    expect(result.issue.issue_number).toBe(42);
  });

  it('extracts title from metadata', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Markdown Title\n\n' + 'Content. '.repeat(30),
      metadata: { title: 'Metadata Title' },
    }, 'run-1');

    expect(result.issue.title).toBe('Metadata Title');
  });

  it('falls back to h1 for title', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# H1 Title\n\n' + 'Content. '.repeat(30),
    }, 'run-1');

    expect(result.issue.title).toBe('H1 Title');
  });

  it('uses Untitled when no title found', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: 'Just some content without a heading. '.repeat(10),
    }, 'run-1');

    expect(result.issue.title).toBe('Untitled');
  });

  it('extracts publish date from metadata', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\n' + 'Content. '.repeat(30),
      metadata: { 'article:published_time': '2024-03-15T10:00:00Z' },
    }, 'run-1');

    expect(result.issue.published_at).toBe('2024-03-15');
  });

  it('computes year and month from publish date', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\n' + 'Content. '.repeat(30),
      metadata: { 'article:published_time': '2024-07-20T00:00:00Z' },
    }, 'run-1');

    expect(result.issue.year).toBe(2024);
    expect(result.issue.month).toBe(7);
  });

  it('strips subscription prompts from both markdown and plain text', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\nGood content.\n\nSubscribe to our newsletter\n\nThanks for reading!',
      metadata: {},
    }, 'run-1');

    expect(result.issue.full_text_plain).not.toContain('Subscribe to');
    expect(result.issue.full_text_plain).not.toContain('Thanks for reading');
    expect(result.issue.full_text_markdown).not.toContain('Subscribe to');
    expect(result.issue.full_text_markdown).not.toContain('Thanks for reading');
  });

  it('computes word count accurately', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\none two three four five',
      metadata: {},
    }, 'run-1');

    // "Title" + "one two three four five" = 6 words
    expect(result.issue.word_count).toBeGreaterThanOrEqual(5);
    expect(result.issue.word_count).toBeLessThanOrEqual(7);
  });

  it('sets source_url and canonical_url to page URL', () => {
    const url = 'https://read.fluxcollective.org/p/test-123';
    const result = normalizePage({
      url,
      markdown: '# Title\n\n' + 'Content. '.repeat(30),
    }, 'run-1');

    expect(result.issue.source_url).toBe(url);
    expect(result.issue.canonical_url).toBe(url);
  });

  it('generates a UUID for issue id', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\n' + 'Content. '.repeat(30),
    }, 'run-1');

    expect(result.issue.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('strips Substack footer boilerplate', () => {
    const boilerplate = [
      'Privacy ∙ Terms ∙ Collection notice',
      'Start your SubstackGet the appSubstack is the home for great culture',
      'This site requires JavaScript to run correctly. Please [turn on JavaScript](https://enable-javascript.com/) or unblock scripts',
    ].join('\n');
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\nReal content here.\n\n' + boilerplate,
      metadata: {},
    }, 'run-1');

    expect(result.issue.full_text_plain).not.toContain('Collection notice');
    expect(result.issue.full_text_plain).not.toContain('Start your Substack');
    expect(result.issue.full_text_plain).not.toContain('Substack is the home');
    expect(result.issue.full_text_plain).not.toContain('turn on JavaScript');
    expect(result.issue.full_text_plain).not.toContain('unblock scripts');
    expect(result.issue.full_text_plain).toContain('Real content');
  });

  it('strips Substack engagement widgets', () => {
    const widgets = '71ShareDiscussion about this postCommentsRestacksTopLatestDiscussionsNo posts';
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\nReal content here.\n\n' + widgets,
      metadata: {},
    }, 'run-1');

    expect(result.issue.full_text_plain).not.toContain('ShareDiscussion');
    expect(result.issue.full_text_plain).not.toContain('CommentsRestacks');
    expect(result.issue.full_text_plain).not.toContain('TopLatestDiscussions');
    expect(result.issue.full_text_plain).toContain('Real content');
  });

  it('strips Substack footer from markdown too', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# Title\n\nGood stuff.\n\n© 2024 The FLUX Collective\nPrivacy ∙ Terms ∙ Collection notice\nStart your SubstackGet the app',
      metadata: {},
    }, 'run-1');

    expect(result.issue.full_text_markdown).not.toContain('Collection notice');
    expect(result.issue.full_text_markdown).not.toContain('Start your Substack');
  });
});

describe('computeContentHash', () => {
  it('produces consistent hashes', async () => {
    const hash1 = await computeContentHash('hello world');
    const hash2 = await computeContentHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different content', async () => {
    const hash1 = await computeContentHash('hello');
    const hash2 = await computeContentHash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a hex string', async () => {
    const hash = await computeContentHash('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
