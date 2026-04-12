/**
 * Unit tests for the search box state machine.
 *
 * The state machine models the user-visible states of the search UI:
 *
 *   LANDING_FEATURED  — cold-start page; quote + auto-latest-issue results
 *   LANDING           — stable empty landing; quote only, no results
 *   RESULTS           — user-initiated search; results shown, quote hidden
 *
 * The dismiss widget bug is that the existing code lacks a stable LANDING
 * state: every path to landing re-fires the featured auto-search. These
 * tests pin the intended machine down.
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

  it('dismiss from RESULTS → LANDING (stable, no auto-search)', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'DISMISS' },
    ]);
    expect(s.name).toBe('LANDING');
    expect(s.query).toBe('');
    expect(s.quoteVisible).toBe(true);
    // The bug: previous code would set autoLoadLatest=true here.
    expect(s.autoLoadLatest).toBe(false);
  });

  it('LANDING is a fixed point — re-dismiss is a no-op', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'DISMISS' },
      { type: 'DISMISS' },
      { type: 'DISMISS' },
    ]);
    expect(s.name).toBe('LANDING');
    expect(s.query).toBe('');
    expect(s.autoLoadLatest).toBe(false);
  });

  it('popstate to empty URL → LANDING (not LANDING_FEATURED)', () => {
    const s = run([
      { type: 'LOAD', query: 'trust' },
      { type: 'POPSTATE', query: '' },
    ]);
    expect(s.name).toBe('LANDING');
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

  it('quoteVisible iff in a LANDING state', () => {
    const m = createSearchMachine();
    m.send({ type: 'LOAD', query: '' });
    expect(m.state.quoteVisible).toBe(true);
    m.send({ type: 'SUBMIT', query: 'x' });
    expect(m.state.quoteVisible).toBe(false);
    m.send({ type: 'DISMISS' });
    expect(m.state.quoteVisible).toBe(true);
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
