// Result List Pattern
// Renders search results with density strip, confidence tiers,
// progressive disclosure, and inline expansion.

import { escapeHtml, escapeHtmlPreserveMark, formatDate, cleanTitle, cleanSnippet } from './utils.js';

export function renderResults(container, metaEl, countEl, invalidOpsEl, filterChipsEl, data) {
  countEl.textContent = data.total_hits + ' result' + (data.total_hits !== 1 ? 's' : '');
  metaEl.hidden = false;
  invalidOpsEl.hidden = true;

  if (data.applied_filters && data.applied_filters.length > 0) {
    filterChipsEl.innerHTML = data.applied_filters.map(function (f) {
      return '<span class="chip">' + escapeHtml(f) + '</span>';
    }).join('');
    filterChipsEl.hidden = false;
  } else {
    filterChipsEl.hidden = true;
  }

  if (data.year_distribution && Object.keys(data.year_distribution).length > 0) {
    renderDensityStrip(data.year_distribution);
  }

  container.innerHTML = data.results.map(function (r, i) {
    var dateStr = r.published_at ? formatDate(r.published_at) : '';
    var snippet = cleanSnippet(r.snippet || '');
    var displayTitle = cleanTitle(r.title || '');
    var confidenceCls = r.confidence || 'medium';
    var summary = cleanSnippet(r.summary || '');

    return '<div class="result-card confidence-' + confidenceCls + '" data-index="' + i + '">' +
      '<div class="result-collapsed">' +
        '<div class="result-meta">' +
          (r.issue_number ? '<span class="result-number">#' + r.issue_number + '</span>' : '') +
          (dateStr ? '<span class="result-date">' + dateStr + '</span>' : '') +
        '</div>' +
        '<div class="result-title">' + escapeHtml(displayTitle) + '</div>' +
        (snippet ? '<p class="result-snippet">' + escapeHtmlPreserveMark(snippet) + '</p>' : '') +
      '</div>' +
      '<div class="result-expanded" hidden>' +
        '<div class="result-meta">' +
          (r.issue_number ? '<span class="result-number">#' + r.issue_number + '</span>' : '') +
          (dateStr ? '<span class="result-date">' + dateStr + '</span>' : '') +
        '</div>' +
        '<div class="result-title">' + escapeHtml(displayTitle) + '</div>' +
        (summary ? '<p class="result-summary">' + escapeHtml(summary) + '</p>' : '') +
        '<div class="result-actions">' +
          '<a href="' + escapeHtml(r.canonical_url || '') + '" target="_blank" rel="noopener" class="btn-read">' +
            'Read on Substack' +
          '</a>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Bind click-to-expand
  container.querySelectorAll('.result-card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      // Don't intercept clicks on the Substack link
      if (e.target.closest('.btn-read')) return;

      var collapsed = card.querySelector('.result-collapsed');
      var expanded = card.querySelector('.result-expanded');
      var isOpen = !expanded.hidden;

      // Close all other expanded cards
      container.querySelectorAll('.result-expanded').forEach(function (el) {
        el.hidden = true;
      });
      container.querySelectorAll('.result-collapsed').forEach(function (el) {
        el.hidden = false;
      });

      // Toggle this card
      collapsed.hidden = !isOpen;
      expanded.hidden = isOpen;
    });
  });
}

export function clearResults(container, metaEl, filterChipsEl, emptyStateEl) {
  container.innerHTML = '';
  metaEl.hidden = true;
  filterChipsEl.hidden = true;
  emptyStateEl.hidden = true;
  var densityEl = document.getElementById('density-strip');
  if (densityEl) densityEl.hidden = true;
}

function renderDensityStrip(yearDist) {
  var years = Object.keys(yearDist).map(Number).sort();
  if (years.length === 0) return;

  var minYear = years[0];
  var maxYear = years[years.length - 1];
  var maxCount = Math.max.apply(null, Object.values(yearDist));

  var el = document.getElementById('density-strip');
  if (!el) return;

  var cells = '';
  for (var y = minYear; y <= maxYear; y++) {
    var count = yearDist[y] || 0;
    var opacity = count > 0 ? (0.2 + 0.8 * (count / maxCount)) : 0;
    var title = count > 0 ? y + ': ' + count + ' result' + (count !== 1 ? 's' : '') : y + ': none';
    cells += '<span class="density-cell" style="opacity:' + opacity.toFixed(2) + '" title="' + title + '"></span>';
  }

  el.innerHTML =
    '<span class="density-label">' + minYear + '</span>' +
    '<span class="density-cells">' + cells + '</span>' +
    '<span class="density-label">' + maxYear + '</span>';
  el.hidden = false;
}
