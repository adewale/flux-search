import { stripEmoji } from './emoji';

/**
 * Parse the intrinsic structure of FLUX Review issues into named sections.
 *
 * Section types are identified by emoji patterns in ## headings.
 * The lead essay is always the first ## heading that doesn't match
 * a known recurring section pattern.
 */

export const SECTION_TYPES = [
  'lead_essay',
  'signposts',
  'worth_your_time',
  'lens',
  'book',
  'postcard',
  'fluxers',
  'title_summary', // chunk-level: title + summary as first chunk
  'other',
] as const;

export type SectionType = typeof SECTION_TYPES[number];

export interface ParsedSection {
  type: SectionType;
  title: string;
  body: string;
}

// Patterns that identify recurring sections by their emoji/text prefix
const SECTION_PATTERNS: Array<{ type: SectionType; pattern: RegExp }> = [
  { type: 'signposts', pattern: /signpost/i },
  { type: 'worth_your_time', pattern: /worth\s+your\s+time/i },
  { type: 'lens', pattern: /lens\s+of\s+the\s+week/i },
  { type: 'book', pattern: /book\s+(?:for|of)\s+your/i },
  { type: 'postcard', pattern: /postcard\s+from\s+the\s+future/i },
  { type: 'fluxers', pattern: /more\s+from\s+flux/i },
];

export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');
  const sections: ParsedSection[] = [];

  let currentTitle = '';
  let currentBody: string[] = [];
  let preHeadingBody: string[] = [];
  let foundFirstSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      // Flush previous section
      if (foundFirstSection) {
        sections.push(makeSection(currentTitle, currentBody.join('\n').trim()));
      }

      // Start new section
      currentTitle = trimmed.slice(3);
      currentBody = [];
      foundFirstSection = true;
    } else if (foundFirstSection) {
      currentBody.push(line);
    } else {
      // Collect text before the first ## heading
      preHeadingBody.push(line);
    }
  }

  // Flush last section
  if (foundFirstSection) {
    sections.push(makeSection(currentTitle, currentBody.join('\n').trim()));
  }

  // If there's substantial text before the first heading, treat it as the lead essay.
  // This handles issues where the lead essay heading was stripped (it becomes the page title).
  const preHeadingText = preHeadingBody.join('\n').trim();
  if (preHeadingText.length > 100 && foundFirstSection) {
    sections.unshift({ type: 'lead_essay', title: '', body: preHeadingText });
  }

  // If no sections found at all, treat entire content as 'other'
  if (sections.length === 0) {
    return [{ type: 'other', title: '', body: markdown.trim() }];
  }

  return sections;
}

function makeSection(rawTitle: string, body: string): ParsedSection {
  const cleanTitle = stripEmoji(rawTitle);

  // Check if this is a known recurring section
  for (const { type, pattern } of SECTION_PATTERNS) {
    if (pattern.test(rawTitle) || pattern.test(cleanTitle)) {
      return { type, title: cleanTitle, body };
    }
  }

  // First unknown section is the lead essay
  return { type: 'lead_essay', title: cleanTitle, body };
}
