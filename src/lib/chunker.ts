import type { IssueChunkRow } from '../db/types';

// Target ~300-800 tokens per chunk. Estimate: 1 token ≈ 4 chars
const MIN_CHUNK_CHARS = 1200;  // ~300 tokens
const MAX_CHUNK_CHARS = 3200;  // ~800 tokens
const OVERLAP_CHARS = 200;     // ~50 tokens overlap

export function chunkIssue(
  issueId: string,
  title: string,
  summary: string | null,
  markdownBody: string | null
): IssueChunkRow[] {
  const chunks: IssueChunkRow[] = [];
  let chunkIndex = 0;

  // Chunk 0: title + summary
  const titleChunk = [title, summary].filter(Boolean).join('\n\n');
  chunks.push(makeChunk(issueId, chunkIndex++, 'title_summary', titleChunk));

  if (!markdownBody) return chunks;

  // Split body into sections by headings
  const sections = splitBySections(markdownBody);

  for (const section of sections) {
    const sectionChunks = splitSectionIntoChunks(section.text);
    for (const text of sectionChunks) {
      chunks.push(makeChunk(issueId, chunkIndex++, section.label, text));
    }
  }

  return chunks;
}

interface Section {
  label: string;
  text: string;
}

function splitBySections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let currentLabel = 'body';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch && currentLines.length > 0) {
      sections.push({ label: currentLabel, text: currentLines.join('\n').trim() });
      currentLabel = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ label: currentLabel, text: currentLines.join('\n').trim() });
  }

  return sections.filter(s => s.text.length > 0);
}

function splitSectionIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + MAX_CHUNK_CHARS;

    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Try to break at a paragraph boundary
    const segment = text.slice(start, end);
    let breakPoint = segment.lastIndexOf('\n\n');
    if (breakPoint < MIN_CHUNK_CHARS) {
      // Try sentence boundary
      breakPoint = segment.lastIndexOf('. ');
      if (breakPoint < MIN_CHUNK_CHARS) {
        // Fall back to word boundary
        breakPoint = segment.lastIndexOf(' ');
      }
    }

    if (breakPoint > MIN_CHUNK_CHARS) {
      end = start + breakPoint + 1;
    }

    chunks.push(text.slice(start, end).trim());
    // Overlap: start next chunk a bit before end
    start = end - OVERLAP_CHARS;
  }

  return chunks.filter(c => c.length > 0);
}

function makeChunk(issueId: string, index: number, sectionLabel: string, text: string): IssueChunkRow {
  const tokenEstimate = Math.ceil(text.length / 4);
  return {
    id: `${issueId}-chunk-${index}`,
    issue_id: issueId,
    chunk_index: index,
    section_label: sectionLabel,
    chunk_text: text,
    token_estimate: tokenEstimate,
    content_hash: '', // Will be computed during ingestion
  };
}
