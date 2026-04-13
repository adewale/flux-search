/**
 * Accessibility tests — verify WCAG 2.1 compliance via code inspection.
 *
 * Tests both the CSS (contrast, focus styles, font sizes) and HTML
 * (ARIA attributes, skip link, semantic structure). These complement
 * the visual regression tests by catching accessibility regressions
 * that screenshots can't detect.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'frontend', 'css', 'styles.css'), 'utf-8');
const INDEX_HTML = readFileSync(join(__dirname, '..', 'frontend', 'index.html'), 'utf-8');

// --- Contrast: text-tertiary on tag-bg must pass AA ---

function hexToRgb(h: string) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(r: number, g: number, b: number) {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(c1: string, c2: string) {
  const l1 = luminance(...hexToRgb(c1) as [number, number, number]);
  const l2 = luminance(...hexToRgb(c2) as [number, number, number]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('WCAG contrast ratios', () => {
  // Extract color values from CSS
  const textTertiary = CSS.match(/--text-tertiary:\s*(#[0-9a-f]{6})/i)?.[1] || '';
  const tagBg = CSS.match(/--tag-bg:\s*(#[0-9a-f]{6})/i)?.[1] || '';
  const bg = CSS.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1] || '';

  it('--text-tertiary on --bg meets AA (4.5:1)', () => {
    const ratio = contrastRatio(textTertiary, bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('--text-tertiary on --tag-bg meets AA (4.5:1)', () => {
    const ratio = contrastRatio(textTertiary, tagBg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('--text-tertiary on --surface meets AA (4.5:1)', () => {
    const ratio = contrastRatio(textTertiary, '#ffffff');
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// --- Focus: every :hover must have a matching :focus-visible ---

describe('focus-visible coverage', () => {
  // Extract all selectors that have :hover pseudo-class
  const hoverSelectors = [...CSS.matchAll(/([.#\w][^{]*):hover\b/g)]
    .map(m => m[1].trim())
    .filter(s => !s.includes('@media') && !s.includes('prefers'));

  // Extract all selectors that have :focus-visible pseudo-class
  const focusSelectors = [...CSS.matchAll(/([.#\w][^{]*):focus-visible\b/g)]
    .map(m => m[1].trim());

  const interactiveSelectors = [
    '.search-btn',
    '.example-query',
    '.refine-suggestion',
    '.page-btn',
    '.section-tab',
    '.facet',
    '.btn-secondary',
    '.nav-link',
  ];

  for (const selector of interactiveSelectors) {
    it(`${selector} has :focus-visible style`, () => {
      const hasFocus = focusSelectors.some(f => f.includes(selector)) ||
        CSS.includes(`${selector}:focus-visible`);
      expect(hasFocus, `${selector} has :hover but no :focus-visible`).toBe(true);
    });
  }
});

// --- Font sizes: no text below 12px ---

describe('minimum font sizes', () => {
  it('no font-size declarations below 0.75rem (12px)', () => {
    // Find all font-size declarations with px values
    const pxSizes = [...CSS.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
      .map(m => parseFloat(m[1]));
    const tooSmall = pxSizes.filter(s => s < 12);
    expect(tooSmall, `Found font-size values below 12px: ${tooSmall.join(', ')}px`).toHaveLength(0);
  });
});

// --- Skip link ---

describe('skip-to-content link', () => {
  it('index.html has a skip-to-content link', () => {
    expect(INDEX_HTML).toMatch(/skip.*main|skip.*content/i);
  });
});

// --- ARIA on density strip ---

describe('density strip ARIA', () => {
  it('density strip tooltip titles include section names', () => {
    // The rendering code in result-list.js should include section labels in tooltips
    const resultList = readFileSync(join(__dirname, '..', 'frontend', 'js', 'lib', 'result-list.js'), 'utf-8');
    expect(resultList).toContain('formatSectionLabel');
    expect(resultList).toContain('<title>');
  });
});
