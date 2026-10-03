/**
 * Page-module wiring: run the real frontend page scripts and assert what
 * they write into the document. These replace source-text greps that could
 * not tell a working page from one that merely mentioned the right names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeElement, installPageGlobals, loadPage } from './helpers-page';
import { parseQuery } from '../src/lib/query-parser';
// @ts-ignore — JS module
import { renderResults } from '../frontend/js/lib/result-list.js';

const HOSTILE = '<img src=x onerror="alert(1)">';

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // A page that threw inside its try/catch would fall back to its error
  // view; fail loudly instead of asserting against that fallback.
  const errors = consoleError.mock.calls;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
});

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
}

describe('topics page: "Search this topic" link', () => {
  async function renderDetail(keyword: string) {
    const page = await loadPage('../frontend/js/topics-page.js', {
      pathname: '/topics/' + encodeURIComponent(keyword),
      api: {
        ['/topics/' + encodeURIComponent(keyword)]: {
          keyword,
          keyword_display: keyword.toUpperCase(),
          doc_frequency: 3,
          issues: [],
        },
      },
    });
    await vi.waitFor(() => expect(page.el('topics-detail').hidden).toBe(false));
    return page;
  }

  it.each([
    ['governance', 'governance'],
    // Multi-word topics need the quoted form, or the second word leaks
    // into free text.
    ['institutional trust', 'institutional trust'],
    // An unencoded "&" would end the q parameter early.
    ['r&d', 'r d'],
  ])('%s → SPA search filtered to topic "%s"', async (keyword, expectedTopic) => {
    const page = await renderDetail(keyword);
    const link = hrefs(page.el('topics-detail').innerHTML).find(h => h.startsWith('/?'));
    expect(link, 'search link points at the SPA, not the JSON /search endpoint').toBeDefined();

    const q = new URLSearchParams(link!.slice(2)).get('q') ?? '';
    const parsed = parseQuery(q);
    expect(parsed.filters.topic).toBe(expectedTopic);
    expect(parsed.freeText).toBe('');
  });

  it('escapes the keyword on the not-found view', async () => {
    const page = await loadPage('../frontend/js/topics-page.js', {
      pathname: '/topics/' + encodeURIComponent(HOSTILE),
      api: {},
    });
    await vi.waitFor(() => expect(page.el('topics-detail').hidden).toBe(false));
    const html = page.el('topics-detail').innerHTML;
    expect(html).toContain('Topic not found: &lt;img');
    expect(html).not.toContain('<img');
  });
});

describe('issue page: section rendering', () => {
  const section = { type: 'lead_essay', title: HOSTILE, body: 'Intro **bold**\n\n' + HOSTILE };

  async function renderIssue(windowExtras: Record<string, unknown> = {}) {
    const page = await loadPage('../frontend/js/issue-page.js', {
      pathname: '/issues/issue/42',
      windowExtras,
      api: {
        '/issues/issue/42/sections': {
          issue_number: 42,
          title: 'Issue title',
          published_at: '2024-01-06T00:00:00Z',
          canonical_url: 'https://read.fluxcollective.org/p/x',
          sections: [section],
        },
      },
    });
    await vi.waitFor(() => expect(page.el('issue-page').hidden).toBe(false));
    return page.el('section-content').innerHTML;
  }

  it('escapes crawled HTML with the built-in renderer when no CDN libraries loaded', async () => {
    const html = await renderIssue();
    expect(html).toContain('<h2 class="section-heading">&lt;img');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<img');
  });

  it('does not use marked until DOMPurify is also present', async () => {
    const marked = vi.fn((md: string) => md);
    const html = await renderIssue({ marked });
    expect(marked).not.toHaveBeenCalled();
    expect(html).not.toContain('<img');
  });

  it('sanitizes marked output with DOMPurify when both are present', async () => {
    // Stand-ins record the order of operations: sanitize must wrap marked's
    // output, not run on the markdown before marked sees it.
    const marked = (md: string) => `[marked:${md}]`;
    const DOMPurify = { sanitize: (html: string) => `[clean:${html}]` };
    const html = await renderIssue({ marked, DOMPurify });
    expect(html).toContain(`<div class="section-body">[clean:[marked:${section.body}]]</div>`);
    expect(html).toContain('<h2 class="section-heading">&lt;img');
  });
});

describe('density strip tooltips', () => {
  it('name each section with its display label and count', () => {
    const page = installPageGlobals({ pathname: '/' });
    const el = () => new FakeElement();
    renderResults(el(), el(), el(), el(), el(), {
      total_hits: 4,
      results: [],
      quarter_distribution: {
        '2023-Q2': { lead_essay: 2, worth_your_time: 1 },
        '2023-Q3': { signposts: 1 },
      },
    });

    const svg = page.el('density-content').innerHTML;
    const titles = [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map(m => m[1]);
    expect(titles).toEqual([
      'Q2 2023 — 3 results (Essay: 2, Worth your time: 1)',
      'Q3 2023 — 1 result',
    ]);
    expect(page.el('density-strip').hidden).toBe(false);
  });
});
