import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverAllIssueUrls } from '../src/crawler/sitemap-parser';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function xmlResponse(xml: string) {
  return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
}

describe('discoverAllIssueUrls', () => {
  it('parses a flat urlset sitemap (Substack format)', async () => {
    mockFetch.mockResolvedValue(xmlResponse(`
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://read.fluxcollective.org/archive</loc></url>
        <url><loc>https://read.fluxcollective.org/p/198</loc><lastmod>2025-07-18</lastmod></url>
        <url><loc>https://read.fluxcollective.org/p/197</loc><lastmod>2025-07-11</lastmod></url>
        <url><loc>https://read.fluxcollective.org/about</loc></url>
      </urlset>
    `));

    const entries = await discoverAllIssueUrls();

    expect(entries).toHaveLength(2); // only /p/ URLs
    expect(entries[0].loc).toBe('https://read.fluxcollective.org/p/198');
    expect(entries[0].lastmod).toBe('2025-07-18');
    expect(entries[1].loc).toBe('https://read.fluxcollective.org/p/197');
  });

  it('follows sitemap index to sub-sitemaps', async () => {
    // First call returns sitemap index
    mockFetch
      .mockResolvedValueOnce(xmlResponse(`
        <?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex>
          <sitemap><loc>https://example.com/sitemap-2024.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sitemap-2025.xml</loc></sitemap>
        </sitemapindex>
      `))
      // Second call returns 2024 sitemap
      .mockResolvedValueOnce(xmlResponse(`
        <urlset>
          <url><loc>https://example.com/p/100</loc><lastmod>2024-01-01</lastmod></url>
        </urlset>
      `))
      // Third call returns 2025 sitemap
      .mockResolvedValueOnce(xmlResponse(`
        <urlset>
          <url><loc>https://example.com/p/200</loc><lastmod>2025-01-01</lastmod></url>
        </urlset>
      `));

    const entries = await discoverAllIssueUrls();

    expect(entries).toHaveLength(2);
    expect(entries[0].loc).toBe('https://example.com/p/100');
    expect(entries[1].loc).toBe('https://example.com/p/200');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('filters out non-issue URLs', async () => {
    mockFetch.mockResolvedValue(xmlResponse(`
      <urlset>
        <url><loc>https://example.com/archive</loc></url>
        <url><loc>https://example.com/about</loc></url>
        <url><loc>https://example.com/p/42</loc></url>
        <url><loc>https://example.com/subscribe</loc></url>
      </urlset>
    `));

    const entries = await discoverAllIssueUrls();
    expect(entries).toHaveLength(1);
    expect(entries[0].loc).toContain('/p/');
  });

  it('handles entries without lastmod', async () => {
    mockFetch.mockResolvedValue(xmlResponse(`
      <urlset>
        <url><loc>https://example.com/p/1</loc></url>
      </urlset>
    `));

    const entries = await discoverAllIssueUrls();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastmod).toBeNull();
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 500 }));
    await expect(discoverAllIssueUrls()).rejects.toThrow('Failed to fetch sitemap: 500');
  });

  it('sends crawler headers when fetching sitemaps', async () => {
    mockFetch.mockResolvedValue(xmlResponse(`
      <urlset>
        <url><loc>https://example.com/p/1</loc></url>
      </urlset>
    `));

    const entries = await discoverAllIssueUrls();

    expect(entries).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith('https://read.fluxcollective.org/sitemap.xml', {
      headers: {
        'User-Agent': 'FluxSearch/1.0 (archive indexer)',
        'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    });
  });

  it('retries a rate-limited top-level sitemap fetch once', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(xmlResponse(`
        <urlset>
          <url><loc>https://example.com/p/1</loc></url>
        </urlset>
      `));

    const entries = await discoverAllIssueUrls();

    expect(entries).toHaveLength(1);
    expect(entries[0].loc).toBe('https://example.com/p/1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles sub-sitemap fetch failure gracefully', async () => {
    mockFetch
      .mockResolvedValueOnce(xmlResponse(`
        <sitemapindex>
          <sitemap><loc>https://example.com/sitemap-good.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sitemap-bad.xml</loc></sitemap>
        </sitemapindex>
      `))
      .mockResolvedValueOnce(xmlResponse(`
        <urlset>
          <url><loc>https://example.com/p/1</loc></url>
        </urlset>
      `))
      .mockResolvedValueOnce(new Response('', { status: 500 }));

    const entries = await discoverAllIssueUrls();
    expect(entries).toHaveLength(1); // only from the good sitemap
  });

  it('handles slug-based /p/ URLs', async () => {
    mockFetch.mockResolvedValue(xmlResponse(`
      <urlset>
        <url><loc>https://read.fluxcollective.org/p/the-flux-review-ep-215</loc><lastmod>2025-11-14</lastmod></url>
        <url><loc>https://read.fluxcollective.org/p/semantic-similarity-note-taking</loc><lastmod>2024-10-29</lastmod></url>
      </urlset>
    `));

    const entries = await discoverAllIssueUrls();
    expect(entries).toHaveLength(2);
  });
});
