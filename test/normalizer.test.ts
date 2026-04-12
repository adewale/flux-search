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

  it('does not duplicate lead essay title as a heading in body', () => {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/test',
      markdown: '# FLUX Review\n\n> "A great quote"\n\n## 🧠🔋 The decision treadmill\n\nEssay body here.\n\n## 🛣️🚩 Signposts\n\nMore content.',
      metadata: {},
    }, 'run-1');

    expect(result.issue.title).toBe('The decision treadmill');
    expect(result.issue.lead_essay_title).toBe('The decision treadmill');
    // The heading should NOT appear in the body since it's the page title
    const headingPattern = /##\s+.*decision treadmill/i;
    expect(result.issue.full_text_markdown).not.toMatch(headingPattern);
    // But the essay body content should survive
    expect(result.issue.full_text_markdown).toContain('Essay body here');
    // And other headings should survive
    expect(result.issue.full_text_markdown).toContain('Signposts');
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

describe('date/photo crud stripping (issue #207)', () => {
  /** Helper: run markdown through normalizePage and return cleaned text */
  function clean(markdown: string) {
    const result = normalizePage({
      url: 'https://read.fluxcollective.org/p/207',
      markdown: '# Test Issue\n\n' + markdown,
      metadata: {},
    }, 'run-1');
    return {
      md: result.issue.full_text_markdown,
      plain: result.issue.full_text_plain,
    };
  }

  it('strips standalone date headings like "### September 18th, 2025"', () => {
    const { md, plain } = clean(
      '### September 18th, 2025\n\n## 🪄 Lead essay\n\nReal content here.'
    );
    expect(md).not.toContain('September 18th, 2025');
    expect(plain).not.toContain('September 18th, 2025');
    expect(plain).toContain('Real content');
  });

  it('strips standalone date headings with various formats', () => {
    // "### October 9th, 2025", "### January 29th, 2026", "### May 1, 2024"
    for (const date of ['October 9th, 2025', 'January 29th, 2026', 'May 1, 2024', 'March 14, 2024']) {
      const { plain } = clean(`### ${date}\n\n## 🧠 Essay\n\nContent.`);
      expect(plain).not.toContain(date);
    }
  });

  it('strips the byline mega-line (profile + date + share + image caption + episode)', () => {
    // This is the actual pattern from issue 207's raw markdown after HTML→markdown conversion
    const bylineMegaLine = '[The FLUX Collective](https://substack.com/@galex)Sep 19, 2025101Share' +
      '[](https://substackcdn.com/image/fetch/example.png)' +
      '[ A simple system ] - The game Factorio, Ed Bradon, [https://worksinprogress.co/](https://worksinprogress.co/)' +
      'Episode 207 — September 18th, 2025 — Available at [read.fluxcollective.org/p/207](https://read.fluxcollective.org/p/207)' +
      'Contributors to this issue: [Neel](https://substack.com/profile/123-neel)' +
      'Additional insights from: [Ade](https://substack.com/profile/456-ade)' +
      "*We're a ragtag band of systems thinkers*";
    const { md, plain } = clean(bylineMegaLine + '\n\n## 🪄 Real heading\n\nReal content.');
    // After all stripping, no remnants of the byline should survive
    expect(plain).not.toContain('Sep 19');
    expect(plain).not.toContain('A simple system');
    expect(plain).not.toContain('worksinprogress.co');
    expect(plain).not.toContain('Ed Bradon');
    expect(plain).toContain('Real content');
  });

  it('strips image caption lines with square brackets', () => {
    // Pattern: "Mon DD, [ caption ] - description, author, URL"
    const { plain } = clean(
      'Sep 19, [ A simple system ] - The game Factorio, Ed Bradon, https://worksinprogress.co/\n\nReal content.'
    );
    expect(plain).not.toContain('A simple system');
    expect(plain).not.toContain('Ed Bradon');
    expect(plain).toContain('Real content');
  });

  it('converts bare URL link text to domain name in plain text', () => {
    const { plain } = clean(
      'See [https://worksinprogress.co/](https://worksinprogress.co/) for more.\n\nReal content.'
    );
    // Should not have the raw URL as link text; should either strip or show domain
    expect(plain).not.toMatch(/https?:\/\//);
    expect(plain).toContain('Real content');
  });

  it('preserves legitimate content mentioning dates in prose', () => {
    const { plain } = clean(
      "The event happened on September 18th, 2025 and changed everything."
    );
    expect(plain).toContain('September 18th, 2025');
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
