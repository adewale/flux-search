/**
 * Unit tests for the search box state machine.
 *
 * The state machine models the user-visible states of the search UI:
 *
 *   LANDING_FEATURED  — cold-start page; quote + auto-latest-issue results
 *   LANDING           — stable empty landing; quote only, no results
 *   RESULTS           — user-initiated search; results shown, quote hidden
 *   BROWSING          — results still shown but the search box is empty
 *                       (user tapped ✕ to clear the query in-place)
 *
 * Dismissing is a *local* action: it empties the input without tearing
 * down the results list. These tests pin that semantic down.
 */

import { describe, it, expect } from 'vitest';
import { createSearchMachine, type Event, type State } from '../frontend/js/lib/search-state.js';

function run(events: Event[]): State {
  const m = createSearchMachine();
  for (const e of events) m.send(e);
  return m.state;
}

describe('search state machine — states', () => {
  it('cold start with no query → LANDING_FEATURED', () => {
    const s = run([{ type: 'LOAD', query: '' }]);
    expect(s.name).toBe('LANDING_FEATURED');
    expect(s.query).toBe('');
    expect(s.quoteVisible).toBe(true);
    expect(s.autoLoadLatest).toBe(true);
  });

  it('cold start with ?q=… → RESULTS', () => {
    const s = run([{ type: 'LOAD', query: 'trust' }]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('trust');
    expect(s.quoteVisible).toBe(false);
    expect(s.autoLoadLatest).toBe(false);
  });

  it('submit from landing → RESULTS with the user query', () => {
    const s = run([
      { type: 'LOAD', query: '' },
      { type: 'SUBMIT', query: 'hello' },
    ]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('hello');
    expect(s.quoteVisible).toBe(false);
    expect(s.autoLoadLatest).toBe(false);
  });

  it('dismiss from RESULTS → BROWSING: results remain, input is empty', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'DISMISS' },
    ]);
    expect(s.name).toBe('BROWSING');
    expect(s.query).toBe('');
    expect(s.resultsVisible).toBe(true);   // results are preserved
    expect(s.quoteVisible).toBe(false);    // came from RESULTS, quote was hidden
    expect(s.clearVisible).toBe(false);    // nothing to clear
    expect(s.autoLoadLatest).toBe(false);  // no auto-search
  });

  it('dismiss from LANDING_FEATURED keeps the quote and the featured results', () => {
    const s = run([
      { type: 'LOAD', query: '' }, // cold start → LANDING_FEATURED (quote + latest-issue results)
      { type: 'DISMISS' },
    ]);
    expect(s.name).toBe('BROWSING');
    expect(s.resultsVisible).toBe(true);
    expect(s.quoteVisible).toBe(true);     // strictly preserved from prior state
    expect(s.query).toBe('');
  });

  it('dismiss from LANDING (empty) is a no-op', () => {
    const m = createSearchMachine();
    // Force directly into LANDING via popstate.
    m.send({ type: 'POPSTATE', query: '' });
    const before = m.state;
    m.send({ type: 'DISMISS' });
    expect(m.state).toEqual(before);
  });

  it('BROWSING is a fixed point under repeated dismiss', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'DISMISS' },
      { type: 'DISMISS' },
      { type: 'DISMISS' },
    ]);
    expect(s.name).toBe('BROWSING');
    expect(s.query).toBe('');
  });

  it('submitting a new query from BROWSING transitions to RESULTS', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'DISMISS' },
      { type: 'SUBMIT', query: 'hope' },
    ]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('hope');
  });

  it('popstate to empty URL → LANDING (tears down results, unlike DISMISS)', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'POPSTATE', query: '' },
    ]);
    expect(s.name).toBe('LANDING');
    expect(s.resultsVisible).toBe(false);
    expect(s.autoLoadLatest).toBe(false);
  });

  it('popstate with query → RESULTS', () => {
    const s = run([
      { type: 'LOAD', query: '' },
      { type: 'POPSTATE', query: 'hello' },
    ]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('hello');
  });

  it('example-query click → RESULTS', () => {
    const s = run([
      { type: 'LOAD', query: '' },
      { type: 'EXAMPLE', query: 'institutional trust' },
    ]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('institutional trust');
  });

  it('facet click from RESULTS appends section:', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'FACET', section: 'essays' },
    ]);
    expect(s.name).toBe('RESULTS');
    expect(s.query).toBe('trust section:essays');
  });

  it('facet click replaces existing section filter', () => {
    const s = run([
      { type: 'LOAD', query: 'trust section:letters' },
      { type: 'FACET', section: 'essays' },
    ]);
    expect(s.query).toBe('trust section:essays');
  });

  it('refine click replaces the matching operator', () => {
    const s = run([
      { type: 'LOAD', query: 'trust before:2024-01-01' },
      { type: 'REFINE', append: 'before:2023-01-01' },
    ]);
    expect(s.query).toBe('trust before:2023-01-01');
  });
});

describe('search state machine — invariants', () => {
  it('empty input after DISMISS', () => {
    const m = createSearchMachine();
    m.send({ type: 'LOAD', query: 'trust' });
    m.send({ type: 'DISMISS' });
    expect(m.state.query).toBe('');
  });

  it('clear-button visibility mirrors non-empty query', () => {
    const m = createSearchMachine();
    expect(m.state.clearVisible).toBe(false);
    m.send({ type: 'SUBMIT', query: 'x' });
    expect(m.state.clearVisible).toBe(true);
    m.send({ type: 'DISMISS' });
    expect(m.state.clearVisible).toBe(false);
  });

  it('quoteVisible is preserved across dismiss', () => {
    // From RESULTS: quote is hidden, dismiss keeps it hidden.
    const m = createSearchMachine();
    m.send({ type: 'LOAD', query: 'x' });
    expect(m.state.quoteVisible).toBe(false);
    m.send({ type: 'DISMISS' });
    expect(m.state.quoteVisible).toBe(false);

    // From LANDING_FEATURED: quote is visible, dismiss keeps it visible.
    const m2 = createSearchMachine();
    m2.send({ type: 'LOAD', query: '' });
    expect(m2.state.quoteVisible).toBe(true);
    m2.send({ type: 'DISMISS' });
    expect(m2.state.quoteVisible).toBe(true);
  });

  it('autoLoadLatest only true on the first LOAD event with empty query', () => {
    const m = createSearchMachine();
    m.send({ type: 'LOAD', query: '' });
    expect(m.state.autoLoadLatest).toBe(true);
    m.send({ type: 'DISMISS' });
    expect(m.state.autoLoadLatest).toBe(false);
    m.send({ type: 'POPSTATE', query: '' });
    expect(m.state.autoLoadLatest).toBe(false);
  });
});
