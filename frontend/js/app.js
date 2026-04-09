// FLUX Review Search — Pattern composition layer
//
// The search app is a lens, not a destination.
// Results expand inline; reading happens on Substack.

import { initAutocomplete } from './lib/autocomplete.js';
import { renderResults, clearResults } from './lib/result-list.js';

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

  if (!form || !input) return;

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
    performSearch(initialQ);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q) {
      var url = new URL(window.location);
      url.searchParams.set('q', q);
      history.pushState(null, '', url);
      performSearch(q);
    }
  });

  window.addEventListener('popstate', function () {
    var q = new URLSearchParams(window.location.search).get('q') || '';
    input.value = q;
    if (q) performSearch(q);
    else clearResults(resultsEl, resultsMeta, filterChips, emptyState);
  });

  async function performSearch(q) {
    loadingEl.hidden = false;
    clearResults(resultsEl, resultsMeta, filterChips, emptyState);

    try {
      var resp = await fetch('/search?q=' + encodeURIComponent(q));
      var data = await resp.json();

      loadingEl.hidden = true;

      if (data.results && data.results.length > 0) {
        renderResults(resultsEl, resultsMeta, resultCount, invalidOps, filterChips, data);
      } else {
        emptyState.hidden = false;
      }
    } catch (err) {
      loadingEl.hidden = true;
      emptyState.hidden = false;
      console.error('Search error:', err);
    }
  }
}
