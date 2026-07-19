/**
 * Property-based tests for the search box state machine.
 *
 * Invariants encoded here — any sequence of events must preserve:
 *   I1  DISMISS always yields query=''. If results were on screen it
 *       lands in BROWSING; otherwise the prior state is preserved.
 *   I2  Any state with empty query is a fixed point under DISMISS.
 *   I3  quoteVisible ⇒ name ≠ RESULTS (the quote never shows alongside
 *       user-query results). BROWSING preserves the prior quoteVisible.
 *   I4  clearVisible ⇔ query.length > 0.
 *   I5  autoLoadLatest can only be true in LANDING_FEATURED.
 *   I6  resultsVisible ⇔ name ∈ {RESULTS, BROWSING, FEATURED_RESULTS}.
 *   I7  query is always a string (never null/undefined/NaN).
 *   I8  The reducer is pure: reduce(s, e) given identical inputs returns
 *       structurally equal outputs.
 *   I9  Once the user has left LANDING_FEATURED, it is unreachable
 *       (no transition goes back to it).
 *   I10 DISMISS preserves resultsVisible: if results were showing before,
 *       they are still showing after.
 *   I12 The ✕ is never wrongly hidden — clearVisible is derived from
 *       query length in every state, even auto-populated ones like
 *       FEATURED_RESULTS.
 *   I13 User editing permanently cancels the cold-start latest issue.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createSearchMachine,
  reduce,
  type Event,
  type State,
} from '../frontend/js/lib/search-state.js';

const anyQuery = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom('trust', 'issue:198', 'before:2024-01-01', 'section:essays'),
);

const section = fc.constantFrom('essays', 'letters', 'lead_essay', 'signposts');
const refineAppend = fc.constantFrom(
  'before:2024-01-01',
  'after:2020-01-01',
  'section:essays',
  'issue:198',
);

const issueQuery = fc
  .integer({ min: 1, max: 500 })
  .map((n) => 'issue:' + n);

const event: fc.Arbitrary<Event> = fc.oneof(
  anyQuery.map((q) => ({ type: 'LOAD' as const, query: q })),
  issueQuery.map((q) => ({ type: 'LATEST_LOADED' as const, query: q })),
  fc.constant({ type: 'EDIT' as const }),
  anyQuery.map((q) => ({ type: 'SUBMIT' as const, query: q })),
  anyQuery.map((q) => ({ type: 'EXAMPLE' as const, query: q })),
  section.map((s) => ({ type: 'FACET' as const, section: s })),
  refineAppend.map((a) => ({ type: 'REFINE' as const, append: a })),
  fc.constant({ type: 'DISMISS' as const }),
  anyQuery.map((q) => ({ type: 'POPSTATE' as const, query: q })),
);

function runAll(events: Event[]): State {
  const m = createSearchMachine();
  for (const e of events) m.send(e);
  return m.state;
}

describe('PBT — search state machine invariants', () => {
  it('I1: DISMISS always empties the query and never auto-loads', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 20 }), (events) => {
        const s = runAll([...events, { type: 'DISMISS' }]);
        expect(s.query).toBe('');
        expect(s.autoLoadLatest).toBe(false);
        expect(s.clearVisible).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('I2: any state with empty query is a fixed point under DISMISS', () => {
    fc.assert(
      fc.property(
        fc.array(event, { maxLength: 10 }),
        fc.integer({ min: 2, max: 8 }),
        (events, dismisses) => {
          const m = createSearchMachine();
          for (const e of events) m.send(e);
          m.send({ type: 'DISMISS' });
          const first = m.state;
          for (let i = 1; i < dismisses; i++) m.send({ type: 'DISMISS' });
          // Structural equality: redundant dismisses must not change the state.
          expect(m.state).toEqual(first);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('I3: quoteVisible implies name is not RESULTS', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const s = runAll(events);
        if (s.quoteVisible) expect(s.name).not.toBe('RESULTS');
      }),
      { numRuns: 300 },
    );
  });

  it('I4: clearVisible iff query is non-empty', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const s = runAll(events);
        expect(s.clearVisible).toBe(s.query.length > 0);
      }),
      { numRuns: 300 },
    );
  });

  it('I5: autoLoadLatest only true in LANDING_FEATURED', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const s = runAll(events);
        if (s.autoLoadLatest) expect(s.name).toBe('LANDING_FEATURED');
      }),
      { numRuns: 300 },
    );
  });

  it('I6: resultsVisible iff name ∈ {RESULTS, BROWSING, FEATURED_RESULTS}', () => {
    const withResults = new Set(['RESULTS', 'BROWSING', 'FEATURED_RESULTS']);
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const s = runAll(events);
        expect(s.resultsVisible).toBe(withResults.has(s.name));
      }),
      { numRuns: 300 },
    );
  });

  it('I7: query is always a string', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const s = runAll(events);
        expect(typeof s.query).toBe('string');
      }),
      { numRuns: 200 },
    );
  });

  it('I8: reducer is pure (same inputs → equal outputs)', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 10 }), event, (prefix, e) => {
        const base = runAll(prefix);
        const a = reduce(base, e);
        const b = reduce(base, e);
        expect(a).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });

  it('I9: LANDING_FEATURED is only reachable as the result of the first LOAD event', () => {
    // Equivalently: once the machine has left LANDING_FEATURED, no event
    // can bring it back.
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 15 }), (events) => {
        const m = createSearchMachine();
        let hasLeftFeatured = false;
        let wasFeatured = false;
        for (const e of events) {
          m.send(e);
          if (wasFeatured && m.state.name !== 'LANDING_FEATURED') {
            hasLeftFeatured = true;
          }
          if (hasLeftFeatured) {
            expect(m.state.name).not.toBe('LANDING_FEATURED');
          }
          wasFeatured = m.state.name === 'LANDING_FEATURED';
        }
      }),
      { numRuns: 300 },
    );
  });

  it('I10: DISMISS preserves resultsVisible and quoteVisible', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 15 }), (events) => {
        const m = createSearchMachine();
        for (const e of events) m.send(e);
        const before = m.state;
        m.send({ type: 'DISMISS' });
        expect(m.state.resultsVisible).toBe(before.resultsVisible);
        expect(m.state.quoteVisible).toBe(before.quoteVisible);
      }),
      { numRuns: 300 },
    );
  });

  it('I12: prefilled queries show the ✕ (FEATURED_RESULTS case)', () => {
    fc.assert(
      fc.property(issueQuery, (q) => {
        const m = createSearchMachine();
        m.send({ type: 'LOAD', query: '' });
        m.send({ type: 'LATEST_LOADED', query: q });
        expect(m.state.name).toBe('FEATURED_RESULTS');
        expect(m.state.query).toBe(q);
        expect(m.state.clearVisible).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('I13: EDIT prevents every later LATEST_LOADED event from taking over', () => {
    fc.assert(
      fc.property(fc.array(issueQuery, { minLength: 1, maxLength: 10 }), (queries) => {
        const m = createSearchMachine();
        m.send({ type: 'LOAD', query: '' });
        m.send({ type: 'EDIT' });
        for (const query of queries) m.send({ type: 'LATEST_LOADED', query });
        expect(m.state.name).toBe('LANDING');
        expect(m.state.query).toBe('');
      }),
      { numRuns: 200 },
    );
  });

  it('I11: FACET produces a query containing section:<s> exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(event, { maxLength: 10 }),
        section,
        (events, s) => {
          const m = createSearchMachine();
          for (const e of events) m.send(e);
          m.send({ type: 'FACET', section: s });
          const matches = m.state.query.match(/section:\S+/g) || [];
          expect(matches).toHaveLength(1);
          expect(matches[0]).toBe('section:' + s);
        },
      ),
      { numRuns: 200 },
    );
  });
});
