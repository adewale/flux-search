/**
 * Pure-string render tests for topic UI helpers.
 *
 * No DOM environment is needed because each helper is a pure
 * (data → HTML string) function. We assert structural invariants
 * (links, escaping, empty-state behaviour) and use fast-check for
 * adversarial input.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
// @ts-ignore — JS module
import {
  topicChipsHtml,
  topicSidePanelHtml,
  topicMobileDetailsHtml,
  relatedIssuesMobileDetailsHtml,
  topicLandingStripHtml,
  topicsIndexHtml,
} from '../frontend/js/lib/topic-render.js';

const TOPICS = [
  { keyword: 'institutional trust', keyword_display: 'Institutional Trust' },
  { keyword: 'governance', keyword_display: 'Governance' },
  { keyword: 'civic repair', keyword_display: 'Civic Repair' },
];

describe('topicChipsHtml', () => {
  it('returns empty string for empty / missing input', () => {
    expect(topicChipsHtml([])).toBe('');
    expect(topicChipsHtml(null as any)).toBe('');
    expect(topicChipsHtml(undefined as any)).toBe('');
  });

  it('renders one chip per topic with display text', () => {
    const html = topicChipsHtml(TOPICS);
    expect(html).toContain('Institutional Trust');
    expect(html).toContain('Governance');
    expect(html).toContain('Civic Repair');
    expect((html.match(/class="chip"/g) ?? [])).toHaveLength(3);
  });

  it('chip links go to /search?q=topic:"keyword"', () => {
    const html = topicChipsHtml(TOPICS);
    // URL-encoded keyword inside topic:"…"
    expect(html).toContain('href="/search?q=' + encodeURIComponent('topic:"institutional trust"') + '"');
  });

  it('respects the max option', () => {
    const html = topicChipsHtml(TOPICS, { max: 1 });
    expect(html).toContain('Institutional Trust');
    expect(html).not.toContain('Governance');
  });

  it('accepts plain string topics for convenience', () => {
    const html = topicChipsHtml(['ai', 'alignment']);
    expect(html).toContain('>ai<');
    expect(html).toContain('>alignment<');
  });

  it('escapes HTML in display text and keyword', () => {
    const html = topicChipsHtml([
      { keyword: 'evil <s>', keyword_display: '<img src=x onerror=alert(1)>' },
    ]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<s>');
    expect(html).toContain('&lt;img');
  });

  it('skips topics with no keyword', () => {
    const html = topicChipsHtml([{ keyword: '', keyword_display: 'ghost' }]);
    expect(html).toBe('');
  });

  it('PBT: never produces an unescaped < or > outside known tag positions', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            keyword: fc.string({ maxLength: 30 }),
            keyword_display: fc.string({ maxLength: 30 }),
          }),
          { maxLength: 5 },
        ),
        (topics) => {
          const html = topicChipsHtml(topics);
          // Allow only the known <a class="…">…</a> tags
          const tagless = html.replace(/<a class="[^"]+" href="[^"]+">|<\/a>/g, '');
          expect(tagless).not.toMatch(/[<>]/);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('topicSidePanelHtml', () => {
  it('returns empty string when topics empty', () => {
    expect(topicSidePanelHtml([])).toBe('');
  });

  it('uses an <aside> with descriptive aria-label', () => {
    const html = topicSidePanelHtml(TOPICS);
    expect(html).toContain('<aside');
    expect(html).toContain('aria-label="Topics in this issue"');
    expect(html).toContain('issue-topics-panel');
  });

  it('contains chips for each topic', () => {
    const html = topicSidePanelHtml(TOPICS);
    expect(html).toContain('Institutional Trust');
    expect(html).toContain('Civic Repair');
  });

  it('renders related issues in the same side panel', () => {
    const html = topicSidePanelHtml(TOPICS, {
      relatedIssues: [
        { issue_number: 21, title: 'Neighbor issue', overlap: 2 },
      ],
    });
    expect(html).toContain('Related issues');
    expect(html).toContain('Neighbor issue');
    expect(html).toContain('#21');
    expect(html).toContain('2 shared');
  });
});

describe('topicMobileDetailsHtml', () => {
  it('uses <details>/<summary> for no-JS toggle', () => {
    const html = topicMobileDetailsHtml(TOPICS);
    expect(html.startsWith('<details')).toBe(true);
    expect(html).toContain('<summary>Topics (3)</summary>');
  });

  it('renders related issues as a separate mobile details block', () => {
    const html = relatedIssuesMobileDetailsHtml([
      { issue_number: 22, title: 'Mobile neighbor', overlap: 1 },
    ]);
    expect(html).toContain('Related issues');
    expect(html).toContain('Mobile neighbor');
  });

  it('returns empty string when no topics', () => {
    expect(topicMobileDetailsHtml([])).toBe('');
  });
});

describe('topicLandingStripHtml', () => {
  const CORPUS = [
    { keyword: 'governance', keyword_display: 'governance', doc_frequency: 12 },
    { keyword: 'ai', keyword_display: 'AI', doc_frequency: 9 },
    { keyword: 'institutional trust', keyword_display: 'institutional trust', doc_frequency: 7 },
  ];

  it('renders a <section> with title "Recurring themes"', () => {
    const html = topicLandingStripHtml(CORPUS);
    expect(html).toContain('Recurring themes');
    expect(html).toContain('<section');
  });

  it('chips link to /topics/<keyword>', () => {
    const html = topicLandingStripHtml(CORPUS);
    expect(html).toContain('href="/topics/' + encodeURIComponent('institutional trust') + '"');
  });

  it('shows doc_frequency next to each chip', () => {
    const html = topicLandingStripHtml(CORPUS);
    expect(html).toContain('>12<');
    expect(html).toContain('>9<');
  });

  it('caps at 12 chips', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      keyword: 'k' + i,
      keyword_display: 'k' + i,
      doc_frequency: 30 - i,
    }));
    const html = topicLandingStripHtml(many);
    const matches = html.match(/class="chip"/g) ?? [];
    expect(matches.length).toBe(12);
  });

  it('returns empty string when corpus is empty', () => {
    expect(topicLandingStripHtml([])).toBe('');
  });
});

describe('topicsIndexHtml', () => {
  it('shows an empty-state placeholder when no topics', () => {
    expect(topicsIndexHtml([])).toContain('No topics yet');
  });

  it('renders one row per topic with frequency', () => {
    const html = topicsIndexHtml([
      { keyword: 'a', keyword_display: 'A', doc_frequency: 3 },
      { keyword: 'b', keyword_display: 'B', doc_frequency: 2 },
    ]);
    expect((html.match(/<li class="topics-row"/g) ?? [])).toHaveLength(2);
    expect(html).toContain('>A<');
    expect(html).toContain('>3<');
  });
});
