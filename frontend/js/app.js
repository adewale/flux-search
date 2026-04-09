// FLUX Review Search — Pattern composition layer
//
// Alexander's insight: each pattern resolves forces in a specific context.
// This file is the "courtyard" that connects them — it doesn't contain
// behavior, only routing and wiring.

import { initAutocomplete } from './lib/autocomplete.js';
import { renderResults, clearResults } from './lib/result-list.js';
import { initIssueReader } from './lib/issue-reader.js';

var path = window.location.pathname;

if (path.startsWith('/issues/issue/')) {
  initIssueReader();
} else {
  initSearchPage();
}

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

  // Wire the Autocomplete Pattern
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

  // Restore query from URL
  var params = new URLSearchParams(window.location.search);
  var initialQ = params.get('q');
  if (initialQ) {
    input.value = initialQ;
    performSearch(initialQ);
  }

  // Form submit
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
