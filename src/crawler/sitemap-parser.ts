export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

const SITEMAP_URL = 'https://read.fluxcollective.org/sitemap.xml';

export async function discoverAllIssueUrls(): Promise<SitemapEntry[]> {
  const response = await fetch(SITEMAP_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status}`);
  }
  const xml = await response.text();

  // Try extracting <url> entries directly (flat urlset format)
  let entries = extractUrlEntries(xml);

  // If no <url> entries found, it might be a sitemap index — chase sub-sitemaps
  if (entries.length === 0) {
    const subSitemapUrls = extractSitemapIndexUrls(xml);
    console.log(`Found ${subSitemapUrls.length} sub-sitemaps`);

    const fetchPromises = subSitemapUrls.map(async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return [];
        return extractUrlEntries(await resp.text());
      } catch (err) {
        console.error(`Error fetching sitemap ${url}:`, err);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    entries = results.flat();
  }

  // Filter to only issue URLs (containing /p/)
  const issueEntries = entries.filter(e => e.loc.includes('/p/'));
  console.log(`Discovered ${issueEntries.length} issue URLs from ${entries.length} total`);

  return issueEntries;
}

function extractUrlEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/g;
  let block;
  while ((block = urlBlockRegex.exec(xml)) !== null) {
    const content = block[1];
    const locMatch = content.match(/<loc>([^<]+)<\/loc>/);
    const lastmodMatch = content.match(/<lastmod>([^<]+)<\/lastmod>/);

    if (locMatch) {
      entries.push({
        loc: locMatch[1].trim(),
        lastmod: lastmodMatch ? lastmodMatch[1].trim() : null,
      });
    }
  }
  return entries;
}

function extractSitemapIndexUrls(xml: string): string[] {
  const urls: string[] = [];
  const regex = /<sitemap>\s*<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}
