// FLUX Review Search — Pattern composition layer
//
// The search app is a lens, not a destination.
// Results link to Substack; reading happens there.

import { initAutocomplete } from './lib/autocomplete.js';
import { renderResults, clearResults, renderPagination } from './lib/result-list.js';

initSearchPage();

function initSearchPage() {
  var form = document.getElementById('search-form');
  var input = document.getElementById('search-input');
  var dropdown = document.getElementById('autocomplete-dropdown');
  var resultsEl = document.getElementById('results');
  var resultsMeta = document.getElementById('results-meta');
  var resultCount = document.getElementById('result-count');
  var invalidOps = document.getElementById('invalid-operators');
  var filterChips = document.getElementById('filter-chips');
  var emptyState = document.getElementById('empty-state');
  var loadingEl = document.getElementById('loading');
  var paginationEl = document.getElementById('pagination');

  if (!form || !input) return;

  var refineHints = document.getElementById('refine-hints');
  var exampleQueries = document.querySelector('.example-queries');

  var currentQuery = '';
  var currentPage = 1;
  var pageSize = 20;
  var isLandingSearch = false;

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

  var params = new URLSearchParams(window.location.search);
  var initialQ = params.get('q');
  if (initialQ) {
    input.value = initialQ;
    currentQuery = initialQ;
    performSearch(initialQ, 1);
  } else {
    showLanding();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q) {
      isLandingSearch = false;
      currentQuery = q;
      currentPage = 1;
      updateUrl(q, 1);
      performSearch(q, 1);
    }
  });

  // Clickable section facets
  document.addEventListener('facet-click', function (e) {
    isLandingSearch = false;
    var section = e.detail.section;
    var q = currentQuery.replace(/\s*section:\S+/g, '').trim();
    q = q + ' section:' + section;
    input.value = q;
    currentQuery = q;
    currentPage = 1;
    updateUrl(q, 1);
    performSearch(q, 1);
  });

  window.addEventListener('popstate', function () {
    var p = new URLSearchParams(window.location.search);
    var q = p.get('q') || '';
    var page = parseInt(p.get('page') || '1') || 1;
    input.value = q;
    if (q) {
      isLandingSearch = false;
      performSearch(q, page);
    } else {
      showLanding();
    }
  });

  // Example query buttons — fill search box and submit
  document.querySelectorAll('.example-query').forEach(function (btn) {
    btn.addEventListener('click', function () {
      isLandingSearch = false;
      var q = btn.getAttribute('data-query');
      input.value = q;
      currentQuery = q;
      currentPage = 1;
      updateUrl(q, 1);
      performSearch(q, 1);
    });
  });

  // Refine suggestion buttons — append/replace operator in current query
  document.querySelectorAll('.refine-suggestion').forEach(function (btn) {
    btn.addEventListener('click', function () {
      isLandingSearch = false;
      var appendText = btn.getAttribute('data-query-append');
      var key = appendText.split(':')[0];
      var cleaned = currentQuery.replace(new RegExp('\\b' + key + ':\\S+', 'g'), '').replace(/\s+/g, ' ').trim();
      var q = (cleaned + ' ' + appendText).trim();
      input.value = q;
      currentQuery = q;
      currentPage = 1;
      updateUrl(q, 1);
      performSearch(q, 1);
    });
  });

  async function performSearch(q, page) {
    autocomplete.hide();
    loadingEl.hidden = false;
    clearAll();
    currentQuery = q;
    currentPage = page;

    try {
      var resp = await fetch('/search?q=' + encodeURIComponent(q) + '&page=' + page + '&limit=' + pageSize);
      var data = await resp.json();

      loadingEl.hidden = true;

      if (data.results && data.results.length > 0) {
        renderResults(resultsEl, resultsMeta, resultCount, invalidOps, filterChips, data);
        if (refineHints) refineHints.hidden = false;
        if (exampleQueries) exampleQueries.hidden = true;
        var totalPages = Math.ceil(data.total_hits / pageSize);
        if (totalPages > 1) {
          renderPagination(paginationEl, page, totalPages, function (newPage) {
            isLandingSearch = false;
            currentPage = newPage;
            updateUrl(currentQuery, newPage);
            performSearch(currentQuery, newPage);
            window.scrollTo(0, 0);
          });
        }
      } else {
        emptyState.hidden = false;
      }
    } catch (err) {
      loadingEl.hidden = true;
      emptyState.hidden = false;
      console.error('Search error:', err);
    }
  }

  function showLanding() {
    isLandingSearch = true;
    clearAll();
    loadLandingQuote();
    loadLatestSearch();
  }

  function clearAll() {
    clearResults(resultsEl, resultsMeta, filterChips, emptyState);
    if (paginationEl) paginationEl.hidden = true;
    if (refineHints) refineHints.hidden = true;
    if (exampleQueries) exampleQueries.hidden = false;
    if (!isLandingSearch) {
      var lq = document.getElementById('landing-quote');
      if (lq) lq.hidden = true;
    }
  }

  function updateUrl(q, page) {
    var url = new URL(window.location);
    url.searchParams.set('q', q);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    history.pushState(null, '', url);
  }

  async function loadLandingQuote() {
    try {
      var resp = await fetch('/random-quote');
      var data = await resp.json();
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

  async function loadLatestSearch() {
    try {
      var resp = await fetch('/latest-issue');
      var data = await resp.json();
      if (data.issue_number) {
        var q = 'issue:' + data.issue_number;
        input.value = q;
        currentQuery = q;
        performSearch(q, 1);
      }
    } catch (e) { /* silently degrade */ }
  }

}
