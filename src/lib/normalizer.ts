import type { IssueRow } from '../db/types';
import type { CrawlPageResult } from '../crawler/crawl-client';
import { stripEmoji } from './emoji';

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
  let { cleanMarkdown, plainText } = cleanContent(page.markdown);
  const headings = extractHeadings(cleanMarkdown);
  const authors = page.metadata?.['author'] || null;

  // Extract intrinsic issue structure
  const { leadEssayTitle, openingQuote, leadEssaySummary, leadEssayHeadingLine } = extractIssueStructure(cleanMarkdown);

  // Remove the lead essay heading from body — it becomes the page title,
  // so keeping it in the body creates a visible duplication on the issue page.
  if (leadEssayHeadingLine) {
    cleanMarkdown = cleanMarkdown.replace(leadEssayHeadingLine, '').replace(/\n{3,}/g, '\n\n').trim();
    plainText = plainText.replace(stripEmoji(leadEssayHeadingLine.replace(/^#+\s*/, '')).trim(), '').replace(/\n{3,}/g, '\n\n').trim();
  }

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
  let title = stripEmoji(raw)
    .replace(/\s*-\s*by\s+The\s+FLUX\s+Collective$/i, '')
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
  leadEssayHeadingLine: string | null;
} {
  const lines = markdown.split('\n');

  let openingQuote: string | null = null;
  let leadEssayTitle: string | null = null;
  let leadEssaySummary: string | null = null;
  let leadEssayHeadingLine: string | null = null;

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
      // Reject if the cleaned result is empty, whitespace, or contains
      // only quote/punctuation characters \u2014 those occur when a single
      // bare quote hid inside whitespace and got exposed by trimming
      // (e.g. `> " "     "` \u2192 `"`). Such inputs are not real opening
      // quotes; keep walking lines for a real one.
      if (!openingQuote || /^[\s"">\u201C\u201D]*$/.test(openingQuote)) {
        openingQuote = null;
        continue;
      }
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
      leadEssayTitle = stripEmoji(trimmed.replace(/^##\s+/, '')).trim();
      leadEssayHeadingLine = trimmed;
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

  return { leadEssayTitle, openingQuote, leadEssaySummary, leadEssayHeadingLine };
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
  // Try URL: /p/198 or /p/198-some-slug (number at start of path segment)
  const bareNumberMatch = url.match(/\/p\/(\d+)(?:$|[^0-9])/);
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

  // Try human-readable date FIRST (more reliable — appears in heading area, not URLs)
  const humanMatch = markdown.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
  if (humanMatch) {
    // Strip ordinal suffixes (5th → 5, 1st → 1) before parsing
    const cleaned = humanMatch[1].replace(/(\d+)(?:st|nd|rd|th)/i, '$1');
    const d = new Date(cleaned + ' UTC');
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  // ISO date fallback — only match standalone dates (not inside URLs)
  // Match dates at line start or after whitespace, not after = or / (URL params)
  const dateMatch = markdown.match(/(?:^|[\s])(\d{4}-\d{2}-\d{2})(?:\s|$)/m);
  if (dateMatch) {
    const d = new Date(dateMatch[1] + 'T00:00:00Z');
    if (!isNaN(d.getTime())) {
      const roundtrip = d.toISOString().split('T')[0];
      if (roundtrip === dateMatch[1]) return dateMatch[1];
    }
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

  // --- Site header and episode title ---
  // Raw format: "[](/)# [🌀🗞 The FLUX Review](/)" or "# [🌀🗞 The FLUX Review](/)"
  clean = clean.replace(/^.*FLUX Review.*?\]\(\/\)\s*$/gm, '');
  // "- SubscribeSign in# 🌀🗞 The FLUX Review, Ep. 230" or "- # 🌀🗞 The FLUX Review, Ep. N"
  clean = clean.replace(/^.*FLUX Review,?\s*Ep\.?\s*\d+.*$/gm, '');
  // Plain text remnants after markdown stripping
  clean = clean.replace(/^The FLUX Review\s*$/gm, '');

  // --- Standalone date headings: "### September 18th, 2025" ---
  // These appear as the issue dateline in the header area, not in prose.
  clean = clean.replace(/^#{1,6}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\s*$/gm, '');

  // --- Photo credits and image prompt lines ---
  // "Jun 10, Wind farms in suburbia... // Photo: Spencer Pitman, FLUX"
  // "Apr 10, "FCP-230" // Photo:  with Midjourney"
  clean = clean.replace(/^.*\/\/\s*Photo:.*$/gm, '');
  // "May 19, "FCP-125" ..." without // Photo
  clean = clean.replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+[""\u201C]FCP-\d+[""\u201D].*$/gm, '');
  // Image caption lines with square brackets: "Sep 19, [ A simple system ] - The game Factorio..."
  // These are image alt-text captions that appear after the byline mega-line is partially stripped.
  clean = clean.replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\[.*?\].*$/gm, '');

  // --- Comment/engagement section: strip everything from ReplyShare or Subscribe+NShare onward ---
  // This catches user comments, Liked by, reply counts, TopLatest, etc.
  clean = clean.replace(/\n\s*ReplyShare[\s\S]*$/i, '');
  clean = clean.replace(/\nSubscribe\d+Share[\s\S]*$/i, '');

  // --- Substack subscription/engagement boilerplate ---
  clean = clean.replace(/Subscribe\s+to\s+.+?newsletter/gi, '');
  clean = clean.replace(/Thanks?\s+for\s+reading.*/gi, '');
  clean = clean.replace(/Share\s+this\s+post/gi, '');
  clean = clean.replace(/Leave\s+a\s+comment/gi, '');
  clean = clean.replace(/This newsletter is a collection of patterns.*?weeks\./gi, '');
  clean = clean.replace(/Ready for more\?/gi, '');
  clean = clean.replace(/SubscribeSign in/gi, '');
  // Note: standalone "Subscribe" lines are stripped at the end of the pipeline,
  // after all other stripping exposes them. See "Final Subscribe cleanup" below.

  // --- Substack footer boilerplate ---
  clean = clean.replace(/Privacy\s*[∙·•]\s*Terms\s*[∙·•]\s*Collection notice/gi, '');
  clean = clean.replace(/Start your Substack.*$/gim, '');
  clean = clean.replace(/Substack is the home for great culture/gi, '');
  clean = clean.replace(/This site requires JavaScript.*?unblock scripts/gis, '');
  clean = clean.replace(/©\s*\d{4}.*(?:FLUX|Collective).*$/gim, '');
  clean = clean.replace(/Get the app/gi, '');

  // --- Engagement widgets ---
  clean = clean.replace(/\d*Share\s*Discussion about this post.*$/gim, '');
  clean = clean.replace(/Comments?\s*Restacks?\s*Top\s*Latest\s*Discussions?\s*No posts/gi, '');
  clean = clean.replace(/CommentsRestacksTopLatestDiscussionsNo posts/gi, '');
  clean = clean.replace(/TopLatestDiscussionsNo posts/gi, '');
  // Inline NShare (not anchored to line start/end)
  clean = clean.replace(/\d+Share/gi, '');

  // --- Episode dateline and self-referential link (may be inline, not line-anchored) ---
  clean = clean.replace(/Episode\s+\d+\s*[-–—]+[^#\n]*(?:Available at[^\n]*)?/gi, '');
  clean = clean.replace(/Available at\s+\[?read\.fluxcollective\S*/gi, '');

  // --- "ragtag band" intro (appears in ~229 issues, may be inline) ---
  clean = clean.replace(/We[''\u2019]re a ragtag band of systems thinkers[^\n]*/gi, '');

  // --- Contributor/insights attribution lines ---
  clean = clean.replace(/Contributors?\s+to\s+this\s+issue:.*$/gim, '');
  clean = clean.replace(/Additional\s+insights?\s+from:.*$/gim, '');

  // --- "N more comments" links ---
  clean = clean.replace(/^\[?\d+\s+more\s+comments?\.{0,3}\]?\(.*?\)\s*$/gim, '');
  // Standalone "N reply/replies" links
  clean = clean.replace(/^\[?\d+\s+repl(?:y|ies)\]?\(?.*?\)?\s*$/gim, '');

  // --- Navigation elements ---
  clean = clean.replace(/^\[.*?(Home|Archive|About|Subscribe).*?\]\(.*?\)\s*$/gm, '');

  // --- Empty headings ---
  clean = clean.replace(/^#{1,6}\s*$/gm, '');

  // --- Substack image embeds ---
  clean = clean.replace(/!?\[[^\]]*\]\(https?:\/\/substackcdn\.com[^)]*\)/g, '');
  clean = clean.replace(/!?\[[^\]]*\]\(https?:\/\/bucketeer-[a-f0-9-]+\.s3\.amazonaws\.com[^)]*\)/g, '');
  clean = clean.replace(/!?\[[^\]]*\]\(https?:\/\/substack-post-media\.s3\.amazonaws\.com[^)]*\)/g, '');

  // --- Substack profile links (/@handle and /profile/NNN) ---
  clean = clean.replace(/\[[^\]]*\]\(https?:\/\/substack\.com\/@[^)]*\)/g, '');
  clean = clean.replace(/\[[^\]]*\]\(https?:\/\/substack\.com\/profile\/[^)]*\)/g, '');
  clean = clean.replace(/\[[^\]]*\]\(https?:\/\/open\.substack\.com[^)]*\)/g, '');

  // --- Share/like counters (line-anchored, for any remaining) ---
  clean = clean.replace(/^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})?\d+Share\s*$/gim, '');

  // --- Empty markdown links ---
  clean = clean.replace(/\[\]\([^)]+\)/g, '');

  // --- Byline remnants: orphaned commas from stripped profile links ---
  // Must run AFTER profile link stripping leaves ", , , and N others"
  clean = clean.replace(/(?:,\s*){2,}and\s+\d+\s+others\w*/gi, '');

  // --- Late-pass image caption cleanup ---
  // After profile links, NShare, episode dateline, etc. are stripped from the
  // byline mega-line, exposed fragments like "Sep 19, [ A simple system ] ..."
  // may now be line-anchored. Catch them here.
  clean = clean.replace(/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\[.*?\].*$/gm, '');

  // Final Subscribe cleanup — single pass after all other stripping.
  // Catches standalone "Subscribe" and "Subscribe*" lines that only appear
  // after profile links, engagement widgets, and footer are removed.
  clean = clean.replace(/^\s*Subscribe\*?\s*$/gm, '');
  clean = clean.replace(/\nSubscribe\*?\s*$/gi, '');

  // Normalize whitespace
  clean = clean.replace(/\n{3,}/g, '\n\n');
  clean = clean.trim();

  // Generate plain text by stripping markdown
  let plain = clean;
  plain = plain.replace(/!\[.*?\]\(.*?\)/g, ''); // images
  // Links where the text is a bare URL: replace with domain name only
  plain = plain.replace(/\[(https?:\/\/(?:www\.)?([^/\]]+)[^\]]*)\]\([^)]*\)/g, '$2');
  plain = plain.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // standard links
  // Catch any remaining ](url) fragments from malformed/nested links
  plain = plain.replace(/\]\(https?:\/\/[^)]*\)/g, '');
  plain = plain.replace(/#{1,6}\s+/g, '');
  plain = plain.replace(/[*_]{1,3}(.+?)[*_]{1,3}/g, '$1');
  plain = plain.replace(/`{1,3}[^`]*`{1,3}/g, '');
  // Strip entire blockquote lines (opening quotes are already in opening_quote field)
  plain = plain.replace(/^>.*$/gm, '');
  // Strip attribution lines: — Author, ― Author, — Author
  plain = plain.replace(/^[\u2014\u2015\u2012\u2013—―]\s+.*$/gm, '');
  plain = plain.replace(/[-*+]\s+/g, '');
  // Strip leading emoji from each line (section heading emoji, signpost emoji)
  plain = plain.split('\n').map(line => stripEmoji(line)).join('\n');
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
