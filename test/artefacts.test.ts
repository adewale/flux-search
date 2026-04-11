/**
 * Tests for Substack artefact stripping in the normalizer.
 *
 * These patterns were identified by auditing real Substack HTML from
 * read.fluxcollective.org and represent boilerplate that leaks into
 * full_text_markdown and full_text_plain if the normalizer doesn't strip it.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizePage } from '../src/lib/normalizer';

// Helper: run markdown through normalizePage and return both outputs
function normalize(markdown: string) {
  const result = normalizePage(
    {
      url: 'https://read.fluxcollective.org/p/42',
      markdown,
      metadata: {},
    },
    'test-run',
  );
  return {
    md: result.issue.full_text_markdown,
    plain: result.issue.full_text_plain,
  };
}

// ============================================================
// Substack CDN image URLs
// ============================================================
describe('Substack CDN image URLs', () => {
  it('strips bare substackcdn.com image links', () => {
    const input = `# Title\n\nReal content here.\n\n[](https://substackcdn.com/image/fetch/f_auto,q_auto:good/https%3A%2F%2Fexample.com%2Fimage.png)\n\nMore content.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substackcdn.com');
    expect(plain).not.toContain('substackcdn.com');
  });

  it('strips substackcdn image links with alt text', () => {
    const input = `# Title\n\nContent.\n\n![some image](https://substackcdn.com/image/fetch/w_1456,c_limit/something.png)\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substackcdn.com');
    expect(plain).not.toContain('substackcdn.com');
  });
});

// ============================================================
// Bucketeer S3 image URLs
// ============================================================
describe('Bucketeer S3 image URLs', () => {
  it('strips bare Bucketeer S3 image links', () => {
    const input = `# Title\n\nContent.\n\n[](https://bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com/public/images/foo.png)\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('bucketeer-e05bbc84');
    expect(plain).not.toContain('bucketeer-e05bbc84');
  });

  it('strips Bucketeer S3 image links with alt text', () => {
    const input = `# Title\n\nContent.\n\n![logo](https://bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com/public/images/logo.png)\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('bucketeer-e05bbc84');
    expect(plain).not.toContain('bucketeer-e05bbc84');
  });
});

// ============================================================
// Share/like counters: "612Share", "51Share", "1111Share"
// ============================================================
describe('share/like counters', () => {
  it('strips "612Share" pattern', () => {
    const input = `# Title\n\nContent.\n\n612Share\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('612Share');
    expect(plain).not.toContain('612Share');
  });

  it('strips "51Share" pattern', () => {
    const input = `# Title\n\nContent.\n\n51Share\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('51Share');
    expect(plain).not.toContain('51Share');
  });

  it('strips "1111Share" pattern', () => {
    const input = `# Title\n\nContent.\n\n1111Share\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('1111Share');
    expect(plain).not.toContain('1111Share');
  });

  it('strips share counters with varying numbers', () => {
    const input = `# Title\n\nContent.\n\n3Share\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('3Share');
    expect(plain).not.toContain('3Share');
  });
});

// ============================================================
// Byline fragments with Substack profile links
// ============================================================
describe('byline fragments', () => {
  it('strips "[The FLUX Collective](https://substack.com/@galex)Jul 18, 20251111Share"', () => {
    const input = `# Title\n\n[The FLUX Collective](https://substack.com/@galex)Jul 18, 20251111Share\n\nActual content.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substack.com/@');
    expect(plain).not.toContain('1111Share');
  });

  it('strips byline with different dates and share counts', () => {
    const input = `# Title\n\n[The FLUX Collective](https://substack.com/@galex)May 03, 2024612Share\n\nActual content.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substack.com/@');
    expect(plain).not.toContain('612Share');
  });
});

// ============================================================
// Empty navigation links: [](/)
// ============================================================
describe('empty navigation links', () => {
  it('strips [](/) links', () => {
    const input = `# Title\n\n[](/)\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('[](/)');
    expect(plain).not.toContain('[](/)');
  });

  it('strips empty links with various paths', () => {
    const input = `# Title\n\n[](/archive)\n[](/about)\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('[](/archive)');
    expect(md).not.toContain('[](/about)');
  });
});

// ============================================================
// "SubscribeSign in" merged text
// ============================================================
describe('SubscribeSign in', () => {
  it('strips "SubscribeSign in" merged text', () => {
    const input = `# Title\n\nSubscribeSign in\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('SubscribeSign in');
    expect(plain).not.toContain('SubscribeSign in');
  });
});

// ============================================================
// Date+share merged text: "May 03, 2024612Share"
// ============================================================
describe('date+share merged text', () => {
  it('strips "May 03, 2024612Share"', () => {
    const input = `# Title\n\nMay 03, 2024612Share\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('612Share');
    expect(plain).not.toContain('612Share');
  });

  it('strips "Jul 18, 20251111Share"', () => {
    const input = `# Title\n\nJul 18, 20251111Share\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('1111Share');
    expect(plain).not.toContain('1111Share');
  });

  it('strips date+share on lines with various months and counts', () => {
    const input = `# Title\n\nDec 25, 202399Share\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('99Share');
    expect(plain).not.toContain('99Share');
  });
});

// ============================================================
// Substack profile links (author byline links)
// ============================================================
describe('Substack profile links', () => {
  it('strips links to substack.com/@ profiles', () => {
    const input = `# Title\n\n[The FLUX Collective](https://substack.com/@galex)\n\nContent.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substack.com/@');
    expect(plain).not.toContain('substack.com/@');
  });
});

// ============================================================
// Substack post-media S3 URLs
// ============================================================
describe('Substack post-media S3 URLs', () => {
  it('strips substack-post-media S3 image links', () => {
    const input = `# Title\n\nContent.\n\n![](https://substack-post-media.s3.amazonaws.com/public/images/abc-123.png)\n\nMore.`;
    const { md, plain } = normalize(input);
    expect(md).not.toContain('substack-post-media.s3.amazonaws.com');
    expect(plain).not.toContain('substack-post-media.s3.amazonaws.com');
  });
});

// ============================================================
// Combined artefact scenario (realistic page)
// ============================================================
describe('combined realistic Substack page', () => {
  it('strips all artefacts from a realistic page and preserves real content', () => {
    const input = [
      '# The FLUX Review, Ep. 198',
      '',
      'SubscribeSign in',
      '',
      '[](https://substackcdn.com/image/fetch/f_auto/header.png)',
      '',
      '[The FLUX Collective](https://substack.com/@galex)Jul 18, 20251111Share',
      '',
      '## The Actual Essay Title',
      '',
      'This is the real content of the essay about technology and leadership.',
      '',
      '![](https://bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com/public/images/photo.png)',
      '',
      '## Another Section',
      '',
      'More real content discussing software engineering patterns.',
      '',
      '612Share',
      '',
      '[](/)',
      '',
      'Ready for more?',
    ].join('\n');

    const { md, plain } = normalize(input);

    // Artefacts should be gone
    expect(md).not.toContain('SubscribeSign in');
    expect(md).not.toContain('substackcdn.com');
    expect(md).not.toContain('substack.com/@');
    expect(md).not.toContain('1111Share');
    expect(md).not.toContain('612Share');
    expect(md).not.toContain('bucketeer-e05bbc84');
    expect(md).not.toContain('[](/)');
    expect(md).not.toContain('Ready for more?');

    expect(plain).not.toContain('SubscribeSign in');
    expect(plain).not.toContain('substackcdn.com');
    expect(plain).not.toContain('1111Share');
    expect(plain).not.toContain('612Share');
    expect(plain).not.toContain('bucketeer-e05bbc84');

    // Real content should survive
    expect(plain).toContain('technology and leadership');
    expect(plain).toContain('software engineering patterns');
  });
});

// ============================================================
// Property-based test: random Substack-like boilerplate
// ============================================================
describe('PBT: random Substack boilerplate is always stripped', () => {
  // Arbitraries that generate various Substack artefact strings
  // Use a slug-based path to avoid parentheses breaking markdown link syntax
  const substackCdnUrl = fc
    .stringMatching(/^[a-z0-9_-]{5,40}$/)
    .map(
      (slug) => `[](https://substackcdn.com/image/fetch/f_auto/${slug}.png)`,
    );

  const bucketeerUrl = fc
    .stringMatching(/^[0-9a-f]{5,20}$/)
    .map(
      (hex) =>
        `[](https://bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com/public/images/${hex}.png)`,
    );

  const shareCounter = fc
    .integer({ min: 1, max: 9999 })
    .map((n) => `${n}Share`);

  const dateShareLine = fc
    .tuple(
      fc.constantFrom('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
      fc.integer({ min: 1, max: 28 }),
      fc.integer({ min: 2020, max: 2026 }),
      fc.integer({ min: 1, max: 9999 }),
    )
    .map(([month, day, year, shares]) => `${month} ${String(day).padStart(2, '0')}, ${year}${shares}Share`);

  const bylineLine = fc
    .tuple(
      fc.constantFrom('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'),
      fc.integer({ min: 1, max: 28 }),
      fc.integer({ min: 2020, max: 2026 }),
      fc.integer({ min: 1, max: 9999 }),
    )
    .map(
      ([month, day, year, shares]) =>
        `[The FLUX Collective](https://substack.com/@galex)${month} ${String(day).padStart(2, '0')}, ${year}${shares}Share`,
    );

  const emptyNavLink = fc.constantFrom('[](/)', '[](/archive)', '[](/about)');

  const subscribeSignIn = fc.constant('SubscribeSign in');

  const boilerplateArb = fc.oneof(
    substackCdnUrl,
    bucketeerUrl,
    shareCounter,
    dateShareLine,
    bylineLine,
    emptyNavLink,
    subscribeSignIn,
  );

  it('any generated boilerplate is absent from full_text_plain', () => {
    fc.assert(
      fc.property(
        boilerplateArb,
        fc.string({ minLength: 20, maxLength: 200 }),
        (artefact, content) => {
          const md = `# Title\n\n${content}\n\n${artefact}\n\nMore real text here about systems.`;
          const { plain } = normalize(md);
          // The artefact text (minus markdown link syntax) should not appear
          const artefactPlain = artefact
            .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
            .trim();
          if (artefactPlain.length > 0) {
            expect(plain).not.toContain(artefactPlain);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('any generated boilerplate is absent from full_text_markdown', () => {
    fc.assert(
      fc.property(
        boilerplateArb,
        fc.string({ minLength: 20, maxLength: 200 }),
        (artefact, content) => {
          const md = `# Title\n\n${content}\n\n${artefact}\n\nMore real text here about systems.`;
          const { md: cleanMd } = normalize(md);
          expect(cleanMd).not.toContain(artefact);
        },
      ),
      { numRuns: 200 },
    );
  });
});
