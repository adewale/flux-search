import { describe, it, expect } from 'vitest';
import { normalizePage } from '../src/lib/normalizer';

/** Helper: run markdown through normalizePage and return cleaned text */
function clean(markdown: string) {
  const result = normalizePage({
    url: 'https://read.fluxcollective.org/p/test',
    markdown: '# Test Issue\n\n' + markdown,
    metadata: {},
  }, 'run-1');
  return {
    md: result.issue.full_text_markdown,
    plain: result.issue.full_text_plain,
  };
}

describe('Substack crud stripping', () => {
  // #1 — Site header
  it('strips site header navigation link', () => {
    const { plain } = clean(
      '# [🌀🗞 The FLUX Review](/)\n\n- # 🌀🗞 The FLUX Review, Ep. 55\n\nReal content here.'
    );
    expect(plain).not.toContain('FLUX Review](');
    expect(plain).toContain('Real content');
  });

  // #2 — Standalone Subscribe lines
  it('strips standalone Subscribe lines', () => {
    const { plain, md } = clean(
      'Good paragraph.\n\nSubscribe\n\nMore good stuff.\n\nSubscribe*\n\nFinal paragraph.'
    );
    expect(plain).not.toMatch(/^\s*Subscribe\s*$/m);
    expect(md).not.toMatch(/^\s*Subscribe\*?\s*$/m);
    expect(plain).toContain('Good paragraph');
    expect(plain).toContain('Final paragraph');
  });

  // #3 — Empty ### headings
  it('strips empty headings', () => {
    const { md } = clean('Content.\n\n### \n\nSubscribe');
    expect(md).not.toMatch(/^###\s*$/m);
  });

  // #4 — Inline NShare (not on its own line)
  it('strips inline NShare merged with dates', () => {
    const { plain } = clean(
      ', and 6 othersMay 06, 202193ShareEpisode 01\n\nActual essay text.'
    );
    expect(plain).not.toContain('93Share');
    expect(plain).not.toContain('Share');
    expect(plain).toContain('Actual essay text');
  });

  // #5 — "Available at read.fluxcollective.org"
  it('strips "Available at" self-referential link', () => {
    const { plain } = clean(
      'Available at [read.fluxcollective.org/p/137](https://read.fluxcollective.org/p/137)\n\nEssay content.'
    );
    expect(plain).not.toContain('Available at');
    expect(plain).toContain('Essay content');
  });

  // #6 — "ragtag band" intro
  it('strips the "ragtag band" boilerplate intro', () => {
    const { plain } = clean(
      "We're a ragtag band of systems thinkers who have been dedicating our early mornings to finding new lenses to help us see the complex world around us more clearly.\n\nActual content."
    );
    expect(plain).not.toContain('ragtag band');
    expect(plain).toContain('Actual content');
  });

  // #7 — Contributor / Additional insights lines
  it('strips contributor and insights attribution lines', () => {
    const { plain } = clean(
      'Essay content here.\n\nContributors to this issue: [Neel](https://substack.com/profile/123-neel), [Alex](https://substack.com/profile/456-alex)\n\nAdditional insights from: [Gordon](https://substack.com/profile/789-gordon)'
    );
    expect(plain).not.toContain('Contributors to this issue');
    expect(plain).not.toContain('Additional insights from');
    expect(plain).toContain('Essay content');
  });

  // #8 — substack.com/profile/ links
  it('strips substack.com/profile/ links', () => {
    const { md } = clean(
      'Thanks to [Neel Mehta](https://substack.com/profile/12345-neel-mehta) for help.'
    );
    expect(md).not.toContain('substack.com/profile');
    expect(md).toContain('Thanks to');
  });

  // #9 — Comment section (ReplyShare, user comments, Liked by)
  it('strips entire comment section', () => {
    const { plain } = clean(
      'Final paragraph of essay.\n\nSubscribe\n\nReplyShare\n\n[Danyao W.](https://substack.com/profile/123)May 6, 2021Liked by Neel MehtaSo excited!\n\n1 reply\n\nTopLatestDiscussionsNo posts'
    );
    expect(plain).not.toContain('ReplyShare');
    expect(plain).not.toContain('Danyao');
    expect(plain).not.toContain('Liked by');
    expect(plain).not.toContain('TopLatest');
    expect(plain).not.toContain('1 reply');
    expect(plain).toContain('Final paragraph');
  });

  // #10 — open.substack.com links
  it('strips open.substack.com links', () => {
    const { md } = clean(
      'See [Jasen](https://open.substack.com/pub/releasingthemuse) for more.'
    );
    expect(md).not.toContain('open.substack.com');
  });

  // #11 — Episode dateline
  it('strips "Episode N -- date -- Available at" dateline', () => {
    const { plain } = clean(
      'Episode 137 -- March 14th, 2024 -- Available at read.fluxcollective.org/p/137\n\nEssay begins here.'
    );
    expect(plain).not.toContain('Episode 137');
    expect(plain).not.toContain('Available at');
    expect(plain).toContain('Essay begins here');
  });

  // Additional: "N more comments" links
  it('strips "N more comments" links', () => {
    const { plain } = clean(
      'Content.\n\n[1 more comment...](https://read.fluxcollective.org/p/01/comments)\n\n[3 more comments...](https://read.fluxcollective.org/p/50/comments)'
    );
    expect(plain).not.toContain('more comment');
  });

  // Ensure real content survives
  it('preserves legitimate content that contains trigger words', () => {
    const { plain } = clean(
      'We need to subscribe to the idea that sharing is important. The band of contributors helped.'
    );
    expect(plain).toContain('subscribe to the idea');
    expect(plain).toContain('sharing is important');
    expect(plain).toContain('contributors helped');
  });
});
