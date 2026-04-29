import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('frontend/css/styles.css', 'utf8');

describe('issue page rail layout', () => {
  it('keeps the article column at the standard content width on desktop', () => {
    expect(css).toContain('grid-template-columns: minmax(0, var(--max-width)) 16rem;');
    expect(css).toContain('margin-right: calc(-1 * (16rem + 2rem));');
    expect(css).not.toContain('grid-template-columns: minmax(0, 1fr) 16rem;');
  });
});
