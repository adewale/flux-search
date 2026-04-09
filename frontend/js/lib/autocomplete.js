// Autocomplete Pattern
// Attaches to an input element. Handles debounce, keyboard navigation,
// and dropdown lifecycle. Reusable — takes a fetch function, not hardcoded to any endpoint.

import { escapeHtml } from './utils.js';

export function initAutocomplete(input, dropdownEl, { fetchSuggestions, onSelect }) {
  var activeIndex = -1;
  var suggestions = [];
  var debounceTimer = null;

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    if (q.length < 2) {
      hide();
      return;
    }
    debounceTimer = setTimeout(function () { doFetch(q); }, 200);
  });

  input.addEventListener('keydown', function (e) {
    if (dropdownEl.hidden) return;
    var items = dropdownEl.querySelectorAll('.autocomplete-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      updateActive(items);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      select(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !dropdownEl.contains(e.target)) hide();
  });

  async function doFetch(q) {
    try {
      suggestions = await fetchSuggestions(q);
      if (suggestions.length > 0) show(suggestions);
      else hide();
    } catch (err) {
      hide();
    }
  }

  function show(items) {
    activeIndex = -1;
    dropdownEl.innerHTML = items.map(function (item, i) {
      return '<div class="autocomplete-item" data-index="' + i + '">' +
        '<span class="autocomplete-type">' + escapeHtml(item.type) + '</span>' +
        '<span>' + escapeHtml(item.value) + '</span>' +
        '</div>';
    }).join('');
    dropdownEl.hidden = false;

    dropdownEl.querySelectorAll('.autocomplete-item').forEach(function (el) {
      el.addEventListener('click', function () {
        select(suggestions[parseInt(el.dataset.index)]);
      });
    });
  }

  function hide() {
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = '';
    activeIndex = -1;
    suggestions = [];
  }

  function updateActive(items) {
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  function select(suggestion) {
    if (!suggestion) return;
    onSelect(suggestion);
    hide();
    input.focus();
  }

  return { hide };
}
