/**
 * Design-token contracts for frontend/css/styles.css.
 *
 * CLAUDE.md documents hard rules ("tokens that must be used — no raw
 * values"); these tests pin them so regressions show up in `npm test`
 * instead of in a later audit. Same source-reading pattern as
 * issue-rail-layout.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('frontend/css/styles.css', 'utf8');

/** Strip comments so commented-out rules can't trip the contracts. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('chip primitive', () => {
  it('defines .chip exactly once (one class, no per-surface variants)', () => {
    const defs = code.match(/^\.chip\s*\{/gm) ?? [];
    expect(defs).toHaveLength(1);
  });
});

describe('radius tokens', () => {
  it('every border-radius uses a --radius token', () => {
    const offenders = [...code.matchAll(/border-radius:\s*([^;]+);/g)]
      .map(m => m[1].trim())
      .filter(v => !v.startsWith('var(--radius'));
    expect(offenders).toEqual([]);
  });
});

describe('tracking tokens', () => {
  it('every letter-spacing uses --tracking-tight or --tracking-open', () => {
    const offenders = [...code.matchAll(/letter-spacing:\s*([^;]+);/g)]
      .map(m => m[1].trim())
      .filter(v => v !== 'var(--tracking-tight)' && v !== 'var(--tracking-open)');
    expect(offenders).toEqual([]);
  });
});

describe('breakpoints', () => {
  it('media queries stay within the documented set', () => {
    // CLAUDE.md: three layout breakpoints. The 899px query is the exclusive
    // complement of the 900px tablet breakpoint (same boundary, two ranges).
    // Capability queries (reduced motion, coarse pointer) are orthogonal to
    // the layout scale and allowed.
    const allowed = new Set([
      '(max-width: 640px) and (orientation: portrait)',
      '(min-width: 900px)',
      '(max-width: 899px)',
      '(max-width: 920px) and (orientation: landscape)',
      '(prefers-reduced-motion: reduce)',
      '(hover: none) and (pointer: coarse)',
    ]);
    const queries = [...code.matchAll(/@media\s+([^{]+)\{/g)].map(m => m[1].trim());
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(allowed.has(q), `unexpected media query: ${q}`).toBe(true);
    }
  });
});

describe('custom property hygiene', () => {
  it('every defined token is referenced at least once', () => {
    const defined = [...code.matchAll(/^\s*(--[a-z][a-z0-9-]*)\s*:/gm)].map(m => m[1]);
    expect(defined.length).toBeGreaterThan(20);
    const everywhere = code + readFileSync('frontend/js/lib/result-list.js', 'utf8');
    const unused = [...new Set(defined)].filter(t => !everywhere.includes(`var(${t})`));
    expect(unused).toEqual([]);
  });
});
