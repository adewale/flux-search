import { describe, it, expect } from 'vitest';
import { normalizePage } from '../src/lib/normalizer';

function clean(markdown: string) {
  const result = normalizePage({
    url: 'https://read.fluxcollective.org/p/test',
    markdown: markdown,
    metadata: {},
  }, 'run-1');
  return {
    md: result.issue.full_text_markdown,
    plain: result.issue.full_text_plain,
  };
}

describe('site header and photo credit stripping', () => {
  it('strips "The FLUX Review" site name line', () => {
    const { plain } = clean(
      '# [🌀🗞 The FLUX Review](/)\n\n- # 🌀🗞 The FLUX Review, Ep. 55\n\n## 🧠 Lead essay\n\nReal content here.'
    );
    expect(plain).not.toMatch(/^The FLUX Review$/m);
    expect(plain).not.toContain('The FLUX Review, Ep.');
    expect(plain).toContain('Real content');
  });

  it('strips "The FLUX Review, Ep. N" episode title line from plain text', () => {
    const { plain } = clean(
      '# Test\n\nThe FLUX Review\nThe FLUX Review, Ep. 125\nNovember 9th, 2023\n\n## 🧠 Know thy hooks\n\nAnxiety is everywhere.'
    );
    expect(plain).not.toContain('The FLUX Review, Ep.');
    expect(plain).not.toMatch(/^The FLUX Review$/m);
    expect(plain).toContain('Anxiety is everywhere');
  });

  it('strips photo credit lines', () => {
    const { plain } = clean(
      '# Test\n\n## 🧠 Essay\n\nJun 10, Wind farms in suburbia. Palm Springs, 2018. // Photo: Spencer Pitman, FLUX\n\nReal essay text.'
    );
    expect(plain).not.toContain('// Photo:');
    expect(plain).not.toContain('Spencer Pitman');
    expect(plain).toContain('Real essay text');
  });

  it('strips "FCP-NNN" photo credit lines', () => {
    const { plain } = clean(
      '# Test\n\n## 🧠 Essay\n\nApr 10, "FCP-230" // Photo:  with Midjourney\n\nDecision fatigue is real.'
    );
    expect(plain).not.toContain('FCP-230');
    expect(plain).not.toContain('// Photo:');
    expect(plain).not.toContain('Midjourney');
    expect(plain).toContain('Decision fatigue');
  });

  it('strips date+image-prompt combo lines', () => {
    const { plain } = clean(
      '# Test\n\n## 🧠 Essay\n\nMay 19, "Fractal systems theory" in the styles of Dali // Photo: @ENMBanks using Midjourney\n\nActual content.'
    );
    expect(plain).not.toContain('Fractal systems');
    expect(plain).not.toContain('Midjourney');
    expect(plain).toContain('Actual content');
  });

  it('preserves legitimate content with "Photo" in it', () => {
    const { plain } = clean(
      '# Test\n\n## 🧠 Essay\n\nThe photo essay captured the moment beautifully.'
    );
    expect(plain).toContain('photo essay captured');
  });

  it('strips byline remnants with orphaned commas', () => {
    const { plain } = clean(
      '# Test\n\n, , , and 6 othersMay 06,\n\n## 🧠 Essay\n\nReal content.'
    );
    expect(plain).not.toContain(', , ,');
    expect(plain).not.toContain('6 others');
    expect(plain).toContain('Real content');
  });
});
