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

  var currentQuery = '';
  var currentPage = 1;
  var pageSize = 20;

  initAutocomplete(input, dropdown, {
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
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q) {
      currentQuery = q;
      currentPage = 1;
      updateUrl(q, 1);
      performSearch(q, 1);
    }
  });

  window.addEventListener('popstate', function () {
    var p = new URLSearchParams(window.location.search);
    var q = p.get('q') || '';
    var page = parseInt(p.get('page') || '1') || 1;
    input.value = q;
    if (q) performSearch(q, page);
    else clearAll();
  });

  async function performSearch(q, page) {
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
        var totalPages = Math.ceil(data.total_hits / pageSize);
        if (totalPages > 1) {
          renderPagination(paginationEl, page, totalPages, function (newPage) {
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

  function clearAll() {
    clearResults(resultsEl, resultsMeta, filterChips, emptyState);
    if (paginationEl) paginationEl.hidden = true;
  }

  function updateUrl(q, page) {
    var url = new URL(window.location);
    url.searchParams.set('q', q);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    history.pushState(null, '', url);
  }
}
