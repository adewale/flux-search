/**
 * Tests for the issue section landing page.
 *
 * 1. parseSections PBT invariants
 * 2. Sections API route (via Hono mock)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseSections, SECTION_TYPES } from '../src/lib/sections';

const FULL_ISSUE_MD = `
> "We cannot master everything."

## Just enough structure

An open-source project gets attention.

## Signposts

Crypto coins tied to stocks.

## Worth your time

- [Why Micropayments Will Never Work](https://example.com)

## Lens of the week

This week's lens: **loose coupling**.

## Postcard from the future

*Year 2035.* The last translator closed their office.
`;

// ========================
// parseSections invariants
// ========================
describe('parseSections for landing page', () => {
  it('parses complete issue into typed sections', () => {
    const sections = parseSections(FULL_ISSUE_MD);
    const types = sections.map(s => s.type);
    expect(types).toContain('lead_essay');
    expect(types).toContain('signposts');
    expect(types).toContain('worth_your_time');
    expect(types).toContain('lens');
    expect(types).toContain('postcard');
  });

  it('each section has a body', () => {
    const sections = parseSections(FULL_ISSUE_MD);
    for (const s of sections) {
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

  it('PBT: any markdown produces at least one section', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (md) => {
        expect(parseSections(md).length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it('PBT: types are always from the known set', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (md) => {
        for (const s of parseSections(md)) {
          expect(SECTION_TYPES).toContain(s.type);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('PBT: section bodies never start with ## heading markers', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (md) => {
        for (const s of parseSections(md)) {
          for (const line of s.body.split('\n')) {
            expect(line.trimStart().startsWith('## ')).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
