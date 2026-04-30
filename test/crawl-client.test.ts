import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPage } from '../src/crawler/crawl-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchPage', () => {
  it('returns null on HTTP error', async () => {
    mockFetch.mockResolvedValue(htmlResponse('', 404));
    const result = await fetchPage('https://example.com/p/test');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result).toBeNull();
  });

  it('returns url, markdown, and metadata', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><head><title>Test</title></head><body><p>Hello</p></body></html>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://example.com/p/test');
    expect(result!.metadata.title).toBe('Test');
    expect(result!.markdown).toContain('Hello');
  });
});

describe('extractMetadata (via fetchPage)', () => {
  it('extracts <title>', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<html><head><title>My Title</title></head><body></body></html>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.metadata.title).toBe('My Title');
  });

  it('extracts meta tags with name/property and content', async () => {
    mockFetch.mockResolvedValue(htmlResponse(`
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta name="author" content="Jane Doe">
        <meta property="article:published_time" content="2024-03-15T10:00:00Z">
      </head><body></body></html>
    `));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.metadata['og:title']).toBe('OG Title');
    expect(result!.metadata['author']).toBe('Jane Doe');
    expect(result!.metadata['article:published_time']).toBe('2024-03-15T10:00:00Z');
  });

  it('handles reversed content/name attribute order', async () => {
    mockFetch.mockResolvedValue(htmlResponse(`
      <html><head>
        <meta content="Reversed Value" property="og:description">
      </head><body></body></html>
    `));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.metadata['og:description']).toBe('Reversed Value');
  });
});

describe('htmlToSimpleMarkdown (via fetchPage)', () => {
  it('converts headings', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<h1>Title</h1><h2>Section</h2><h3>Subsection</h3>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('# Title');
    expect(result!.markdown).toContain('## Section');
    expect(result!.markdown).toContain('### Subsection');
  });

  it('converts paragraphs', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p>First paragraph.</p><p>Second paragraph.</p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('First paragraph.');
    expect(result!.markdown).toContain('Second paragraph.');
  });

  it('converts links', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p><a href="https://example.com">Click here</a></p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('[Click here](https://example.com)');
  });

  it('converts bold and italic', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p><strong>bold</strong> and <em>italic</em></p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('**bold**');
    expect(result!.markdown).toContain('*italic*');
  });

  it('converts blockquotes', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<blockquote>A wise quote</blockquote>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('> A wise quote');
  });

  it('converts list items', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<ul><li>Item one</li><li>Item two</li></ul>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('- Item one');
    expect(result!.markdown).toContain('- Item two');
  });

  it('strips script tags', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p>Content</p><script>alert("xss")</script>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toContain('alert');
    expect(result!.markdown).not.toContain('script');
    expect(result!.markdown).toContain('Content');
  });

  it('strips style tags', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<style>.foo{color:red}</style><p>Content</p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toContain('color');
    expect(result!.markdown).toContain('Content');
  });

  it('strips nav, footer, header elements', async () => {
    mockFetch.mockResolvedValue(htmlResponse(`
      <nav>Navigation</nav>
      <header>Header stuff</header>
      <p>Real content</p>
      <footer>Footer stuff</footer>
    `));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toContain('Navigation');
    expect(result!.markdown).not.toContain('Header stuff');
    expect(result!.markdown).not.toContain('Footer stuff');
    expect(result!.markdown).toContain('Real content');
  });

  it('decodes HTML entities', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p>A &amp; B &lt; C &gt; D &quot;quoted&quot; it&#039;s</p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).toContain('A & B < C > D "quoted" it\'s');
  });

  it('removes tags that were HTML-entity encoded in content', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p>Caption before &lt;img src&gt; caption after</p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toContain('<img src>');
    expect(result!.markdown).not.toContain('img src');
    expect(result!.markdown).toContain('Caption before');
    expect(result!.markdown).toContain('caption after');
  });

  it('removes remaining HTML tags', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<div class="wrapper"><span>Text</span></div>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toContain('<');
    expect(result!.markdown).not.toContain('>');
    expect(result!.markdown).toContain('Text');
  });

  it('normalizes excessive newlines', async () => {
    mockFetch.mockResolvedValue(htmlResponse('<p>A</p><p>B</p><p>C</p>'));
    const result = await fetchPage('https://example.com/p/test');
    expect(result!.markdown).not.toMatch(/\n{3,}/);
  });

  it('handles a realistic Substack-like page', async () => {
    const substackHtml = `
      <html>
      <head>
        <title>FLUX Review #42 — Institutional Trust</title>
        <meta property="og:title" content="FLUX Review #42 — Institutional Trust">
        <meta property="article:published_time" content="2024-03-15T10:00:00Z">
        <meta name="author" content="The FLUX Collective">
      </head>
      <body>
        <nav><a href="/">Home</a><a href="/archive">Archive</a></nav>
        <header><div class="post-header">Some header</div></header>
        <h1>FLUX Review #42 — Institutional Trust</h1>
        <p>This week we explore the erosion of <strong>institutional trust</strong> and what it means for <em>coordination problems</em>.</p>
        <h2>The Core Problem</h2>
        <p>Trust is the invisible infrastructure of society. When it breaks, <a href="https://example.com">everything slows down</a>.</p>
        <blockquote>Trust arrives on foot and leaves on horseback.</blockquote>
        <script>window.analytics.track('page_view')</script>
        <footer>Subscribe to our newsletter</footer>
      </body>
      </html>
    `;
    mockFetch.mockResolvedValue(htmlResponse(substackHtml));
    const result = await fetchPage('https://read.fluxcollective.org/p/flux-review-42');

    expect(result!.metadata['og:title']).toBe('FLUX Review #42 — Institutional Trust');
    expect(result!.metadata['article:published_time']).toBe('2024-03-15T10:00:00Z');
    expect(result!.metadata['author']).toBe('The FLUX Collective');

    expect(result!.markdown).toContain('# FLUX Review #42');
    expect(result!.markdown).toContain('**institutional trust**');
    expect(result!.markdown).toContain('*coordination problems*');
    expect(result!.markdown).toContain('## The Core Problem');
    expect(result!.markdown).toContain('[everything slows down](https://example.com)');
    expect(result!.markdown).toContain('> Trust arrives on foot');

    expect(result!.markdown).not.toContain('analytics');
    expect(result!.markdown).not.toContain('Home');
    expect(result!.markdown).not.toContain('Subscribe');
  });
});
