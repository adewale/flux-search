// Search box state machine.
//
// States:
//   LANDING_FEATURED — cold-start transient; quote visible, auto-load-latest
//                      has been requested but hasn't returned yet.
//   FEATURED_RESULTS — latest-issue fetch has landed; query prefilled to
//                      "issue:N", quote still up alongside the results.
//                      Committed input → ✕ is visible.
//   LANDING          — stable empty landing; quote visible, no auto-search
//   RESULTS          — user-driven search; quote hidden, results shown
//   BROWSING         — user tapped ✕ while viewing results; input is empty
//                      but the results list and prior chrome remain visible.
//                      A local clear, not a navigation.
//
// The machine is a pure function of events. It doesn't touch the DOM, fetch,
// or history — app.js is responsible for reflecting `state` back into the UI
// and executing side effects (URL updates, network requests, focus).
//
// @typedef {Object} State
// @property {'LANDING_FEATURED'|'LANDING'|'RESULTS'} name
// @property {string} query
// @property {boolean} quoteVisible
// @property {boolean} autoLoadLatest
// @property {boolean} clearVisible
// @property {boolean} resultsVisible
//
// @typedef {{ type: 'LOAD', query: string }
//          | { type: 'SUBMIT', query: string }
//          | { type: 'EXAMPLE', query: string }
//          | { type: 'FACET', section: string }
//          | { type: 'REFINE', append: string }
//          | { type: 'DISMISS' }
//          | { type: 'POPSTATE', query: string }
//         } Event

function landing(booted = true) {
  return {
    name: 'LANDING',
    query: '',
    quoteVisible: true,
    autoLoadLatest: false,
    clearVisible: false,
    resultsVisible: false,
    booted,
  };
}

function landingFeatured() {
  // Transient cold-start state — waiting for /latest-issue to respond.
  return {
    name: 'LANDING_FEATURED',
    query: '',
    quoteVisible: true,
    autoLoadLatest: true,
    clearVisible: false,
    resultsVisible: false,
    booted: true,
  };
}

function featuredResults(q) {
  // Latest-issue fetch has landed: query is prefilled, results render
  // alongside the quote. The ✕ must show even though the user didn't
  // type this query — the state machine owns the committed input.
  return {
    name: 'FEATURED_RESULTS',
    query: q,
    quoteVisible: true,
    autoLoadLatest: false,
    clearVisible: q.length > 0,
    resultsVisible: true,
    booted: true,
  };
}

function results(q) {
  return {
    name: 'RESULTS',
    query: q,
    quoteVisible: false,
    autoLoadLatest: false,
    clearVisible: q.length > 0,
    resultsVisible: true,
    booted: true,
  };
}

function browsing(prev) {
  // Dismiss in-place: keep whatever the prior state was showing, just
  // empty the search box. `quoteVisible` and any other chrome flags
  // carry over.
  return {
    name: 'BROWSING',
    query: '',
    quoteVisible: prev.quoteVisible,
    autoLoadLatest: false,
    clearVisible: false,
    resultsVisible: true,
    booted: true,
  };
}

function replaceOp(query, key, replacement) {
  const stripped = query
    .replace(new RegExp('\\b' + key + ':\\S+', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
  return (stripped + ' ' + replacement).trim();
}

export function reduce(state, event) {
  switch (event.type) {
    case 'LOAD':
      if (event.query) return results(event.query);
      // LANDING_FEATURED is cold-start only. A LOAD after the machine has
      // already booted (e.g., via SPA navigation) falls back to LANDING.
      return state.booted ? landing(true) : landingFeatured();
    case 'LATEST_LOADED':
      // Only honoured while we're still in the cold-start transient.
      // A late response after the user has typed or dismissed must not
      // hijack the UI.
      if (state.name === 'LANDING_FEATURED' && event.query) {
        return featuredResults(event.query);
      }
      return state;
    case 'POPSTATE':
      return event.query ? results(event.query) : landing();
    case 'SUBMIT':
    case 'EXAMPLE':
      return event.query ? results(event.query) : state;
    case 'FACET':
      return results(replaceOp(state.query, 'section', 'section:' + event.section));
    case 'REFINE': {
      const key = event.append.split(':')[0];
      return results(replaceOp(state.query, key, event.append));
    }
    case 'DISMISS':
      // Dismiss is local: if results are showing, drop into BROWSING and
      // keep them on screen. In LANDING_FEATURED (cold-start, waiting on
      // /latest-issue) the dismiss cancels the pending auto-load and
      // lands on empty LANDING. Otherwise (already on LANDING) no-op.
      if (state.resultsVisible) return browsing(state);
      if (state.name === 'LANDING_FEATURED') return landing(true);
      return state;
    default:
      return state;
  }
}

export function createSearchMachine() {
  // Start unbooted so the first LOAD can reach LANDING_FEATURED.
  let state = landing(false);
  return {
    get state() {
      return state;
    },
    send(event) {
      state = reduce(state, event);
      return state;
    },
  };
}
