// FLUX Review Search — Pattern composition layer
//
// The search app is a lens, not a destination.
// Results link to Substack; reading happens there.

import { initAutocomplete } from './lib/autocomplete.js';
import { renderResults, clearResults, renderPagination } from './lib/result-list.js';
import { createSearchMachine } from './lib/search-state.js';
import { topicLandingStripHtml } from './lib/topic-render.js';

initSearchPage();

function initSearchPage() {
  var form = document.getElementById('search-form');
  var input = document.getElementById('search-input');
  var dropdown = document.getElementById('autocomplete-dropdown');
  var resultsEl = document.getElementById('results');
  var resultCount = document.getElementById('result-count');
  var invalidOps = document.getElementById('invalid-operators');
  var filterChips = document.getElementById('filter-chips');
  var emptyState = document.getElementById('empty-state');
  var loadingEl = document.getElementById('loading');
  var paginationEl = document.getElementById('pagination');

  var clearBtn = document.getElementById('search-clear');

  if (!form || !input) return;

  var refineHints = document.getElementById('refine-hints');
  var exampleQueries = document.querySelector('.example-queries');

  var currentPage = 1;
  var pageSize = 20;
  var searchGeneration = 0;
  var machine = createSearchMachine();

  var autocomplete = initAutocomplete(input, dropdown, {
    fetchSuggestions: async function (q) {
      var resp = await fetch('/autocomplete?q=' + encodeURIComponent(q));
      var data = await resp.json();
      return data.suggestions || [];
    },
    onSelect: function (suggestion) {
      var tokens = input.value.split(/\s+/);
      tokens[tokens.length - 1] = suggestion.value;
      input.value = tokens.join(' ') + ' ';
    },
  });

  // Reflect state into DOM and run side effects.
  function apply(prev, force) {
    var s = machine.state;
    var transitioned = !prev || prev.name !== s.name || prev.query !== s.query;
    // Async completions ignored by the reducer must not rewrite draft input.
    // Popstate can force effects because page changes are outside machine state.
    if (!transitioned && !force) return;

    input.value = s.query;
    if (clearBtn) setClearVisible(!!s.clearVisible);

    if (s.name === 'RESULTS' || s.name === 'FEATURED_RESULTS') {
      performSearch(s.query, currentPage);
      if (s.name === 'FEATURED_RESULTS') loadRecurringThemes();
      else hideRecurringThemes();
    } else if (s.name === 'LANDING' || s.name === 'LANDING_FEATURED') {
      // A result request loses DOM ownership when navigation leaves search.
      searchGeneration++;
      loadingEl.hidden = true;
      autocomplete.hide();
      clearAll(s);
      loadLandingQuote();
      if (s.autoLoadLatest) loadLatestSearch();
      hideRecurringThemes();
    }
    // BROWSING: intentionally no DOM side effects beyond the input-value
    // sync above. Results, chips, pagination and quote stay as they were.
  }

  function dispatch(event) {
    var prev = machine.state;
    machine.send(event);
    // DISMISS is a local clear — don't rewrite the URL. LATEST_LOADED
    // is an internal async completion that shouldn't replace the URL
    // with ?q=issue:N (cold-start view is `/`). Every other event owns
    // the URL.
    if (
      event.type !== 'DISMISS' &&
      event.type !== 'POPSTATE' &&
      event.type !== 'LATEST_LOADED'
    ) {
      syncUrl();
    }
    apply(prev);
  }

  function syncUrl() {
    var s = machine.state;
    var url = new URL(window.location);
    if (s.name === 'RESULTS' && s.query) {
      url.searchParams.set('q', s.query);
      if (currentPage > 1) url.searchParams.set('page', String(currentPage));
      else url.searchParams.delete('page');
    } else if (s.name === 'LANDING' || s.name === 'LANDING_FEATURED') {
      url.searchParams.delete('q');
      url.searchParams.delete('page');
    }
    if (url.toString() !== window.location.toString()) {
      history.pushState(null, '', url);
    }
  }

  // Initial load from URL.
  var params = new URLSearchParams(window.location.search);
  var initialQ = params.get('q') || '';
  var initialPage = parseInt(params.get('page') || '1') || 1;
  currentPage = initialPage > 0 ? initialPage : 1;
  dispatch({ type: 'LOAD', query: initialQ });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q) {
      currentPage = 1;
      dispatch({ type: 'SUBMIT', query: q });
    }
  });

  document.addEventListener('facet-click', function (e) {
    currentPage = 1;
    dispatch({ type: 'FACET', section: e.detail.section });
  });

  window.addEventListener('popstate', function () {
    var p = new URLSearchParams(window.location.search);
    var q = p.get('q') || '';
    var page = parseInt(p.get('page') || '1') || 1;
    currentPage = page > 0 ? page : 1;
    // Apply popstate without re-pushing history. Force side effects because
    // the page number is URL state rather than search-machine state.
    var prev = machine.state;
    machine.send({ type: 'POPSTATE', query: q });
    apply(prev, true);
  });

  document.querySelectorAll('.example-query').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var q = btn.getAttribute('data-query');
      currentPage = 1;
      dispatch({ type: 'EXAMPLE', query: q });
    });
  });

  document.querySelectorAll('.refine-suggestion').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var appendText = btn.getAttribute('data-query-append');
      currentPage = 1;
      dispatch({ type: 'REFINE', append: appendText });
    });
  });

  // Clear button — dismiss the search. On touch devices, release focus so
  // the soft keyboard is dismissed; on pointer devices, keep focus for
  // quick re-typing.
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      // Draft text is intentionally outside machine state. Clear it directly
      // so DISMISS also works when LANDING/BROWSING reduces to a no-op.
      input.value = '';
      setClearVisible(false);
      autocomplete.hide();
      dispatch({ type: 'DISMISS' });
      var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
      if (fine && fine.matches) input.focus();
      else input.blur();
    });
  }

  input.addEventListener('input', function () {
    // Draft input is not a committed query, but it must cancel the cold-start
    // latest-issue transition so a late response cannot overwrite user text.
    if (machine.state.name === 'LANDING_FEATURED') {
      machine.send({ type: 'EDIT' });
    }
    if (clearBtn) setClearVisible(!!input.value);
  });

  function setClearVisible(visible) {
    clearBtn.classList.toggle('is-visible', visible);
    clearBtn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    clearBtn.tabIndex = visible ? 0 : -1;
  }

  async function performSearch(q, page, isPagination) {
    var generation = ++searchGeneration;
    autocomplete.hide();
    loadingEl.hidden = false;
    clearAll(machine.state, isPagination);
    currentPage = page;

    try {
      var resp = await fetch('/search?q=' + encodeURIComponent(q) + '&page=' + page + '&limit=' + pageSize);
      var data = await resp.json();

      // Only the newest search owns the result DOM. Older requests can finish
      // later, but must never replace newer results or their loading state.
      if (generation !== searchGeneration) return;
      loadingEl.hidden = true;

      if (data.results && data.results.length > 0) {
        var skipDensity = isPagination || !machine.state.densityVisible;
        renderResults(resultsEl, null,resultCount, invalidOps, filterChips, data, { skipDensity: skipDensity });
        if (refineHints) refineHints.hidden = false;
        if (exampleQueries) exampleQueries.hidden = true;
        var totalPages = Math.ceil(data.total_hits / pageSize);
        if (totalPages > 1) {
          renderPagination(paginationEl, page, totalPages, function (newPage) {
            currentPage = newPage;
            var url = new URL(window.location);
            url.searchParams.set('q', q);
            if (newPage > 1) url.searchParams.set('page', String(newPage));
            else url.searchParams.delete('page');
            history.pushState(null, '', url);
            performSearch(q, newPage, true);
            window.scrollTo(0, 0);
          });
        }
      } else {
        emptyState.hidden = false;
      }
    } catch (err) {
      if (generation !== searchGeneration) return;
      loadingEl.hidden = true;
      emptyState.hidden = false;
      console.error('Search error:', err);
    }
  }

  function clearAll(s, isPagination) {
    var keepDensity = isPagination && s && s.densityVisible;
    clearResults(resultsEl, null,filterChips, emptyState, { keepDensity: keepDensity });
    if (paginationEl) paginationEl.hidden = true;
    if (refineHints) refineHints.hidden = true;
    if (exampleQueries) exampleQueries.hidden = false;
    // Hide the landing quote whenever we're not in a landing state.
    var lq = document.getElementById('landing-quote');
    if (lq && s && !s.quoteVisible) lq.hidden = true;
    // Hide density strip when state says it shouldn't be visible
    if (s && !s.densityVisible) {
      var ds = document.getElementById('density-strip');
      if (ds) ds.hidden = true;
    }
  }

  async function loadLandingQuote() {
    try {
      var resp = await fetch('/random-quote');
      var data = await resp.json();
      // The request started on a landing state. Do not let a late response
      // resurrect the quote after a user-driven search has taken ownership.
      if (!machine.state.quoteVisible) return;
      if (data.quote) {
        var el = document.getElementById('landing-quote');
        document.getElementById('landing-quote-text').textContent = data.quote;
        var link = document.getElementById('landing-quote-link');
        link.textContent = '#' + data.issue_number + ': ' + data.title;
        link.href = '/issues/issue/' + data.issue_number;
        el.hidden = false;
      }
    } catch (e) { /* silently degrade */ }
  }

  // Only fires in LANDING_FEATURED (cold-start with no query). Dispatches
  // LATEST_LOADED so the state machine transitions to FEATURED_RESULTS —
  // the reducer owns the query, the ✕ visibility, and the search run. If
  // the response arrives after the user has typed or dismissed, the
  // reducer ignores the event.
  async function loadRecurringThemes() {
    var host = document.getElementById('recurring-themes');
    if (!host) return;
    try {
      var resp = await fetch('/topics?sort=frequency&limit=12');
      if (!resp.ok) return;
      var data = await resp.json();
      var html = topicLandingStripHtml(data.topics || []);
      if (html) {
        host.innerHTML = html;
        host.hidden = false;
      } else {
        hideRecurringThemes();
      }
    } catch (e) { /* silently degrade */ }
  }

  function hideRecurringThemes() {
    var host = document.getElementById('recurring-themes');
    if (host) { host.innerHTML = ''; host.hidden = true; }
  }

  async function loadLatestSearch() {
    try {
      var resp = await fetch('/latest-issue');
      var data = await resp.json();
      if (data.issue_number) {
        dispatch({ type: 'LATEST_LOADED', query: 'issue:' + data.issue_number });
      }
    } catch (e) { /* silently degrade */ }
  }
}
