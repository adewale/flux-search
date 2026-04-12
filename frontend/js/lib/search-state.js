// Search box state machine.
//
// States:
//   LANDING_FEATURED — cold-start landing; quote visible, auto-load latest issue
//   LANDING          — stable empty landing; quote visible, no auto-search
//   RESULTS          — user-driven search; quote hidden, results shown
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
      return landing();
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
