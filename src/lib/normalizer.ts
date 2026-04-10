import type { IssueRow } from '../db/types';
import type { CrawlPageResult } from '../crawler/crawl-client';

type ContentType = 'issue' | 'non_issue_post' | 'junk';

interface NormalizedIssue {
  contentType: ContentType;
  issue: IssueRow;
}

export function normalizePage(page: CrawlPageResult, crawlRunId: string): NormalizedIssue {
  const contentType = classifyPage(page.url, page.markdown);

  const issueNumber = extractIssueNumber(page.url, page.markdown);
  const rawTitle = extractTitle(page.markdown, page.metadata);
  const subtitle = extractSubtitle(page.markdown, page.metadata);
  const publishedAt = extractPublishDate(page.markdown, page.metadata);
  const { cleanMarkdown, plainText } = cleanContent(page.markdown);
  const headings = extractHeadings(cleanMarkdown);
  const authors = page.metadata?.['author'] || null;

  // Extract intrinsic issue structure
  const { leadEssayTitle, openingQuote, leadEssaySummary } = extractIssueStructure(cleanMarkdown);

  // Clean title: use lead essay heading if available, otherwise clean the Substack template
  const title = leadEssayTitle || cleanIssueTitle(rawTitle, issueNumber);

  // Summary: prefer lead essay first paragraph over generic extraction
  const summary = leadEssaySummary || extractSummary(cleanMarkdown);

  const year = publishedAt ? new Date(publishedAt).getFullYear() : null;
  const month = publishedAt ? new Date(publishedAt).getMonth() + 1 : null;
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;

  return {
    contentType,
    issue: {
      id: crypto.randomUUID(),
      issue_number: issueNumber,
      title: title || 'Untitled',
      subtitle,
      published_at: publishedAt,
      source_url: page.url,
      canonical_url: page.url,
      authors,
      contributors: authors,
      summary,
      headings,
      lead_essay_title: leadEssayTitle,
      opening_quote: openingQuote,
      full_text_markdown: cleanMarkdown,
      full_text_plain: plainText,
      crawl_run_id: crawlRunId,
      content_hash: '',
      ingested_at: new Date().toISOString(),
      word_count: wordCount,
      status: 'active',
      year,
      month,
      has_semantic_chunks: 0,
    },
  };
}

// Strip Substack boilerplate from title at ingestion time
function cleanIssueTitle(raw: string | null, issueNumber: number | null): string | null {
  if (!raw) return null;
  let title = raw
    .replace(/^[\u{1F300}\u{1F5DE}\s]+/u, '')           // leading emoji
    .replace(/\s*-\s*by\s+The\s+FLUX\s+Collective$/i, '') // author suffix
    .trim();
  // If what remains is just "The FLUX Review, Ep. N", it's not a real title
  if (/^The\s+FLUX\s+Review,?\s*(Ep\.?\s*)?\d*$/i.test(title)) {
    return issueNumber ? `FLUX Review #${issueNumber}` : title;
  }
  return title;
}

// Extract the intrinsic structure of a FLUX Review issue:
// - Opening quote (the first > "..." blockquote)
// - Lead essay title (the first ## heading, which is the issue's thesis)
// - Lead essay body (paragraphs between the first ## and the second ##)
function extractIssueStructure(markdown: string): {
  leadEssayTitle: string | null;
  openingQuote: string | null;
  leadEssaySummary: string | null;
} {
  const lines = markdown.split('\n');

  let openingQuote: string | null = null;
  let leadEssayTitle: string | null = null;
  let leadEssaySummary: string | null = null;

  // Find opening quote: first line starting with > "
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('> \u201C') || trimmed.startsWith('> "')) {
      // Grab the quote text, strip > and quotes
      openingQuote = trimmed
        .replace(/^>\s*/, '')
        .replace(/^[""\u201C>]+/, '')
        .replace(/[""\u201D]+$/, '')
        .trim();
      if (!openingQuote) { openingQuote = null; continue; }
      break;
    }
  }

  // Find first ## heading (the lead essay) and its body
  let inLeadEssay = false;
  const essayParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ') && !inLeadEssay) {
      // First ## heading = lead essay title
      leadEssayTitle = trimmed
        .replace(/^##\s+/, '')
        .replace(/^[\p{Emoji}\p{Emoji_Presentation}\uFE0F\s]+/u, '') // strip leading emoji
        .trim();
      inLeadEssay = true;
      continue;
    }

    if (trimmed.startsWith('## ') && inLeadEssay) {
      // Second ## heading = end of lead essay
      break;
    }

    if (inLeadEssay && trimmed.length > 0 && !isMetadataLine(trimmed)) {
      essayParts.push(trimmed);
    }
  }

  if (essayParts.length > 0) {
    leadEssaySummary = essayParts.join(' ').slice(0, 500).trim();
  }

  return { leadEssayTitle, openingQuote, leadEssaySummary };
}

function classifyPage(url: string, markdown: string): ContentType {
  if (url.includes('/p/')) {
    if (markdown.length > 200) return 'issue';
    return 'junk';
  }
  if (url.endsWith('/archive') || url.endsWith('/about') || url === 'https://read.fluxcollective.org/') {
    return 'non_issue_post';
  }
  return 'junk';
}

function extractIssueNumber(url: string, markdown: string): number | null {
  // Try URL: /p/198 (bare number)
  const bareNumberMatch = url.match(/\/p\/(\d+)$/);
  if (bareNumberMatch) return parseInt(bareNumberMatch[1]);

  // Try URL: /p/flux-review-198 or /p/the-flux-review-ep-198
  const urlEpMatch = url.match(/(?:flux-review-|ep-|ep_)(\d+)/i);
  if (urlEpMatch) return parseInt(urlEpMatch[1]);

  // Try title: "FLUX Review, Ep. 198" or "Ep. 198" or "Ep 198"
  const epMatch = markdown.match(/Ep\.?\s*(\d+)/i);
  if (epMatch) return parseInt(epMatch[1]);

  // Try: FLUX Review #198
  const hashMatch = markdown.match(/FLUX\s+Review[,]?\s*#(\d+)/i);
  if (hashMatch) return parseInt(hashMatch[1]);

  // Try: Episode 198, Issue 198
  const titleMatch = markdown.match(/(?:Episode|Issue)\s+(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1]);

  return null;
}

function extractTitle(markdown: string, metadata?: Record<string, string>): string | null {
  if (metadata?.title) return cleanText(metadata.title);
  if (metadata?.['og:title']) return cleanText(metadata['og:title']);

  const h1Match = markdown.match(/^#\s+(.+)/m);
  if (h1Match) return cleanText(h1Match[1]);

  return null;
}

function extractSubtitle(markdown: string, metadata?: Record<string, string>): string | null {
  if (metadata?.['og:description']) return cleanText(metadata['og:description']);

  const lines = markdown.split('\n');
  let foundTitle = false;
  for (const line of lines) {
    if (!foundTitle && line.startsWith('# ')) {
      foundTitle = true;
      continue;
    }
    if (foundTitle && line.startsWith('## ')) {
      return cleanText(line.replace(/^##\s+/, ''));
    }
    if (foundTitle && line.trim().length > 0 && !line.startsWith('#')) {
      if (line.trim().length < 200) return cleanText(line);
      break;
    }
  }

  return null;
}

function extractPublishDate(markdown: string, metadata?: Record<string, string>): string | null {
  if (metadata?.['article:published_time']) {
    return metadata['article:published_time'].split('T')[0];
  }

  const dateMatch = markdown.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) return dateMatch[1];
  }

  const humanMatch = markdown.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})/i);
  if (humanMatch) {
    const d = new Date(humanMatch[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  return null;
}

function extractSummary(markdown: string): string | null {
  const lines = markdown.split('\n');
  let pastTitle = false;
  const summaryParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!pastTitle) {
      if (trimmed.startsWith('#')) pastTitle = true;
      continue;
    }
    if (trimmed.length === 0 && summaryParts.length > 0) break;
    // Skip obvious metadata/boilerplate lines
    if (isMetadataLine(trimmed)) continue;
    if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('![')) {
      summaryParts.push(trimmed);
    }
    if (summaryParts.join(' ').length > 300) break;
  }

  const summary = summaryParts.join(' ').trim();
  return summary.length > 20 ? summary.slice(0, 500) : null;
}

function extractHeadings(markdown: string): string | null {
  const headings: string[] = [];
  const regex = /^#{1,3}\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    headings.push(match[1].trim());
  }
  return headings.length > 0 ? headings.join(' | ') : null;
}

function isMetadataLine(line: string): boolean {
  // Substack byline/date patterns
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d/i.test(line)) return true;
  // Share/subscribe cruft
  if (/^\d+\s*Share$/i.test(line)) return true;
  if (/^Share\s*this/i.test(line)) return true;
  if (/^Subscribe/i.test(line)) return true;
  // Markdown links that are just navigation
  if (/^\[.*\]\(https?:\/\/substack\.com/i.test(line)) return true;
  // Very short lines that are likely UI elements
  if (line.length < 15 && /^(Share|Like|Comment|Reply)$/i.test(line)) return true;
  return false;
}


function cleanContent(markdown: string): { cleanMarkdown: string; plainText: string } {
  let clean = markdown;

  // Strip subscription prompts
  clean = clean.replace(/Subscribe\s+to\s+.+?newsletter/gi, '');
  clean = clean.replace(/Thanks?\s+for\s+reading.*/gi, '');
  clean = clean.replace(/Share\s+this\s+post/gi, '');
  clean = clean.replace(/Leave\s+a\s+comment/gi, '');

  // Strip navigation elements
  clean = clean.replace(/^\[.*?(Home|Archive|About|Subscribe).*?\]\(.*?\)\s*$/gm, '');

  // Normalize whitespace
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.trim();

  // Generate plain text by stripping markdown
  let plain = clean;
  plain = plain.replace(/!\[.*?\]\(.*?\)/g, '');
  plain = plain.replace(/\[([^\]]+)\]\(.*?\)/g, '$1');
  plain = plain.replace(/#{1,6}\s+/g, '');
  plain = plain.replace(/[*_]{1,3}(.+?)[*_]{1,3}/g, '$1');
  plain = plain.replace(/`{1,3}[^`]*`{1,3}/g, '');
  plain = plain.replace(/>\s+/g, '');
  plain = plain.replace(/[-*+]\s+/g, '');
  plain = plain.replace(/\n{2,}/g, '\n');
  plain = plain.trim();

  return { cleanMarkdown: clean, plainText: plain };
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function computeContentHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
