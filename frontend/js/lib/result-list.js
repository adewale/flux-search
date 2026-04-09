// Result List Pattern
// Renders search results with density strip, confidence tiers,
// and progressive disclosure. Pure rendering — no data fetching.

import { escapeHtml, formatDate, cleanTitle, cleanSnippet } from './utils.js';

export function renderResults(container, metaEl, countEl, invalidOpsEl, filterChipsEl, data) {
  // Result count
  countEl.textContent = data.total_hits + ' result' + (data.total_hits !== 1 ? 's' : '');
  metaEl.hidden = false;

  // Invalid operators
  if (data.parsed_query && data.parsed_query.invalidOperators && data.parsed_query.invalidOperators.length > 0) {
    invalidOpsEl.textContent = 'Unknown: ' + data.parsed_query.invalidOperators.join(', ');
    invalidOpsEl.hidden = false;
  } else {
    invalidOpsEl.hidden = true;
  }

  // Filter chips
  if (data.applied_filters && data.applied_filters.length > 0) {
    filterChipsEl.innerHTML = data.applied_filters.map(function (f) {
      return '<span class="chip">' + escapeHtml(f) + '</span>';
    }).join('');
    filterChipsEl.hidden = false;
  } else {
    filterChipsEl.hidden = true;
  }

  // Density strip
  if (data.year_distribution && Object.keys(data.year_distribution).length > 0) {
    renderDensityStrip(data.year_distribution);
  }

  // Result cards
  container.innerHTML = data.results.map(function (r) {
    var issueUrl = r.issue_number
      ? '/issues/issue/' + r.issue_number
      : '/issues/' + r.issue_id;

    var dateStr = r.published_at ? formatDate(r.published_at) : '';
    var snippet = cleanSnippet(r.snippet || '');
    var displayTitle = cleanTitle(r.title || '');
    var confidenceCls = r.confidence || 'medium';

    return '<div class="result-card confidence-' + confidenceCls + '">' +
      '<a href="' + issueUrl + '">' +
        '<div class="result-meta">' +
          (r.issue_number ? '<span class="result-number">#' + r.issue_number + '</span>' : '') +
          (dateStr ? '<span class="result-date">' + dateStr + '</span>' : '') +
        '</div>' +
        '<div class="result-title">' + escapeHtml(displayTitle) + '</div>' +
        (snippet ? '<p class="result-snippet">' + escapeHtml(snippet) + '</p>' : '') +
      '</a>' +
    '</div>';
  }).join('');
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
