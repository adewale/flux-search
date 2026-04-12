export interface CrawlPageResult {
  url: string;
  markdown: string;
  metadata: Record<string, string>;
}

/**
 * Fetch a Substack page via plain HTTP fetch.
 * Substack pages are server-side rendered — no headless browser needed.
 */
export async function fetchPage(url: string): Promise<CrawlPageResult | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FluxSearch/1.0 (archive indexer)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      console.error(`HTTP fetch failed for ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const metadata = extractMetadata(html);
    const markdown = htmlToSimpleMarkdown(html);

    return { url, markdown, metadata };
  } catch (err) {
    console.error(`Error fetching ${url}:`, err);
    return null;
  }
}

export function extractMetadata(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  // Extract <title> (may have attributes like data-rh="true")
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim();

  // Extract meta tags — handle arbitrary attribute ordering
  // Match all <meta .../> tags, then extract name/property and content from each
  const metaTagRegex = /<meta\s+([^>]+?)\/?\s*>/gi;
  let tagMatch;
  while ((tagMatch = metaTagRegex.exec(html)) !== null) {
    const attrs = tagMatch[1];
    const nameMatch = attrs.match(/(?:name|property)="([^"]+)"/i);
    const contentMatch = attrs.match(/content="([^"]+)"/i);
    if (nameMatch && contentMatch) {
      meta[nameMatch[1]] = contentMatch[1];
    }
  }

  return meta;
}

export function htmlToSimpleMarkdown(html: string): string {
  let text = html;

  // Remove non-content blocks
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

  // Convert inline elements first (before block elements unwrap them)
  text = text.replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<(?:strong|b\b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  text = text.replace(/<(?:em|i\b)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // Convert block elements
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities — named and numeric
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&mdash;/g, '\u2014');
  text = text.replace(/&ndash;/g, '\u2013');
  text = text.replace(/&lsquo;/g, '\u2018');
  text = text.replace(/&rsquo;/g, '\u2019');
  text = text.replace(/&ldquo;/g, '\u201C');
  text = text.replace(/&rdquo;/g, '\u201D');
  text = text.replace(/&hellip;/g, '\u2026');
  text = text.replace(/&bull;/g, '\u2022');
  text = text.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#039;/g, "'");

  // Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}
