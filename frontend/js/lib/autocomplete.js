// Autocomplete Pattern
// Attaches to an input element. Handles debounce, keyboard navigation,
// and dropdown lifecycle. Reusable — takes a fetch function, not hardcoded to any endpoint.

import { escapeHtml } from './utils.js';

export function initAutocomplete(input, dropdownEl, { fetchSuggestions, onSelect }) {
  var activeIndex = -1;
  var suggestions = [];
  var debounceTimer = null;
  var requestGeneration = 0;

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    var generation = ++requestGeneration;
    if (q.length < 2) {
      hide();
      return;
    }
    debounceTimer = setTimeout(function () { doFetch(q, generation); }, 200);
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
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      select(suggestions[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  document.addEventListener('click', function (e) {
    if (!input.contains(e.target) && !dropdownEl.contains(e.target)) hide();
  });

  async function doFetch(q, generation) {
    try {
      var nextSuggestions = await fetchSuggestions(q);
      if (generation !== requestGeneration || input.value.trim() !== q) return;
      suggestions = nextSuggestions;
      if (suggestions.length > 0) show(suggestions);
      else hide();
    } catch (err) {
      if (generation === requestGeneration) hide();
    }
  }

  function show(items) {
    activeIndex = -1;
    dropdownEl.setAttribute('role', 'listbox');
    dropdownEl.innerHTML = items.map(function (item, i) {
      return '<div class="autocomplete-item" role="option" id="ac-item-' + i + '" data-index="' + i + '">' +
        escapeHtml(item.value) +
        '</div>';
    }).join('');
    dropdownEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-autocomplete', 'list');

    dropdownEl.querySelectorAll('.autocomplete-item').forEach(function (el) {
      el.addEventListener('click', function () {
        select(suggestions[parseInt(el.dataset.index)]);
      });
    });
  }

  function hide() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    requestGeneration++;
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = '';
    activeIndex = -1;
    suggestions = [];
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function updateActive(items) {
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
    if (activeIndex >= 0) {
      input.setAttribute('aria-activedescendant', 'ac-item-' + activeIndex);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function select(suggestion) {
    if (!suggestion) return;
    onSelect(suggestion);
    hide();
    input.focus();
  }

  return { hide };
}
