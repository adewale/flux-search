/**
 * Tests for the shared frontend string utilities (frontend/js/lib/utils.js)
 * and the issue-page section rendering trust boundary.
 *
 * Background (codebase audit): the issue page rendered stored newsletter
 * content with weaker escaping than the search page —
 * - section.title was concatenated into innerHTML unescaped
 * - the markdownToHtml link rule emitted href without validating the scheme,
 *   so `[x](javascript:...)` in crawled content became a live link
 * - escapeHtml was DOM-based (untestable in vitest) and did NOT escape
 *   quotes, making it unsafe for attribute contexts; two modules carried
 *   their own copies as a workaround
 *
 * utils.js is now DOM-free so these run as plain unit tests.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import {
  escapeHtml,
  escapeHtmlPreserveMark,
  markdownToHtml,
  renderSectionHtml,
} from '../frontend/js/lib/utils.js';

describe('escapeHtml', () => {
  it('escapes all five HTML special characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('hi')" & more>`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot; &amp; more&gt;'
    );
  });

  it('is safe for attribute contexts (quotes escaped)', () => {
    expect(escapeHtml('" onmouseover="steal()')).not.toContain('"');
    expect(escapeHtml("' onmouseover='steal()")).not.toContain("'");
  });

  it('handles null and undefined like empty strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('PBT: output never contains raw <, >, quotes, or bare ampersands', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = escapeHtml(s);
        expect(out).not.toMatch(/[<>"']/);
        expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
      }),
      { numRuns: 300 }
    );
  });
});

describe('escapeHtmlPreserveMark', () => {
  it('keeps <mark> pairs but escapes everything else', () => {
    const out = escapeHtmlPreserveMark('<mark>hit</mark> & <script>x</script>');
    expect(out).toBe('<mark>hit</mark> &amp; &lt;script&gt;x&lt;/script&gt;');
  });

  it('PBT: only <mark> and </mark> survive as raw tags', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = escapeHtmlPreserveMark(s);
        const tags = out.match(/<[^>]*>/g) ?? [];
        expect(tags.every(t => t === '<mark>' || t === '</mark>')).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});

describe('markdownToHtml link safety', () => {
  it('renders http(s) links as anchors', () => {
    const out = markdownToHtml('[FLUX](https://read.fluxcollective.org)');
    expect(out).toContain('<a href="https://read.fluxcollective.org"');
    expect(out).toContain('>FLUX</a>');
  });

  it('renders relative and fragment links', () => {
    expect(markdownToHtml('[home](/issues/issue/198)')).toContain('href="/issues/issue/198"');
    expect(markdownToHtml('[top](#top)')).toContain('href="#top"');
  });

  it('neutralizes javascript: links to text', () => {
    const out = markdownToHtml("[click me](javascript:alert('x'))");
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a ');
    expect(out).toContain('click me');
  });

  it('neutralizes data: and other non-http schemes', () => {
    for (const url of ['data:text/html,<script>1</script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
      const out = markdownToHtml(`[x](${url})`);
      expect(out, url).not.toContain('<a ');
    }
  });

  it('PBT: emitted href values only ever use http(s), /, or # targets', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 60 }), (text, url) => {
        const out = markdownToHtml(`[${text}](${url})`);
        for (const m of out.matchAll(/href="([^"]*)"/g)) {
          expect(m[1]).toMatch(/^(https?:\/\/|\/|#)/);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('still escapes raw HTML in the body', () => {
    const out = markdownToHtml('hello <script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('renderSectionHtml', () => {
  it('escapes the section title', () => {
    const out = renderSectionHtml({ title: '<img src=x onerror=alert(1)>', body: 'Body.' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('section-heading');
  });

  it('omits the heading when the section has no title', () => {
    const out = renderSectionHtml({ title: '', body: 'Body only.' });
    expect(out).not.toContain('<h2');
    expect(out).toContain('section-body');
    expect(out).toContain('Body only.');
  });

  it('renders the body with the supplied markdown renderer', () => {
    const out = renderSectionHtml({ title: 'T', body: 'ignored' }, () => '<p>custom</p>');
    expect(out).toContain('<p>custom</p>');
  });

  it('falls back to the built-in escaping converter', () => {
    const out = renderSectionHtml({ title: 'T', body: '**bold** <script>x</script>' });
    expect(out).toContain('<strong>bold</strong>');
    expect(out).not.toContain('<script>');
  });
});

// Source-level wiring contracts: the pure helpers above only protect the
// page if issue-page.js actually routes rendering through them. These
// assertions fail if the safe path is bypassed again.
describe('issue page rendering wiring', () => {
  const issuePageSrc = readFileSync('frontend/js/issue-page.js', 'utf8');
  const issueHtmlSrc = readFileSync('frontend/issue.html', 'utf8');

  it('builds section content through renderSectionHtml, not raw concatenation', () => {
    expect(issuePageSrc).toContain('renderSectionHtml(');
    expect(issuePageSrc).not.toMatch(/section-heading.*\+\s*section\.title/);
  });

  it('only uses CDN marked when DOMPurify is present to sanitize its output', () => {
    expect(issuePageSrc).toMatch(/window\.marked\s*&&\s*window\.DOMPurify/);
    expect(issuePageSrc).toContain('DOMPurify.sanitize(');
  });

  it('loads DOMPurify alongside marked', () => {
    expect(issueHtmlSrc).toContain('dompurify');
  });
});

describe('escapeHtml single source of truth', () => {
  it('no frontend module redeclares escapeHtml locally', () => {
    for (const file of [
      'frontend/js/lib/topic-render.js',
      'frontend/js/topics-page.js',
      'frontend/js/app.js',
      'frontend/js/issue-page.js',
      'frontend/js/lib/result-list.js',
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/function\s+escapeHtml/);
    }
  });
});
