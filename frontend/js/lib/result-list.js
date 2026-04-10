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

// Archive landmarks — story beats that give temporal orientation
var LANDMARKS = [
  { year: 2021, label: '#1' },
  { year: 2022, label: '#50' },
  { year: 2023, label: '#100' },
  { year: 2025, label: '#200' },
];

function renderDensityStrip(yearDist) {
  var years = Object.keys(yearDist).map(Number).sort();
  if (years.length === 0) return;

  var el = document.getElementById('density-strip');
  if (!el) return;

  var minYear = years[0];
  var maxYear = years[years.length - 1];
  var span = maxYear - minYear || 1;
  var maxCount = Math.max.apply(null, Object.values(yearDist));
  if (maxCount === 0) return;

  var W = 300;
  var H = 24;

  // Area path — mountain silhouette
  var points = [];
  for (var y = minYear; y <= maxYear; y++) {
    var x = ((y - minYear) / span) * W;
    var count = yearDist[y] || 0;
    var py = H - (count / maxCount) * H;
    points.push(x + ',' + py);
  }
  var path = 'M0,' + H + ' L' + points.join(' L') + ' L' + W + ',' + H + ' Z';

  // Year ticks — short lines rising into the silhouette from the baseline
  var ticks = '';
  for (var y = minYear; y <= maxYear; y++) {
    var tx = ((y - minYear) / span) * W;
    ticks += '<line x1="' + tx + '" y1="' + H + '" x2="' + tx + '" y2="' + (H - 4) + '" class="density-tick" />';
  }

  // Landmark markers — slightly taller ticks
  var visibleLandmarks = LANDMARKS.filter(function (lm) {
    return lm.year >= minYear && lm.year <= maxYear;
  });
  var marks = '';
  for (var i = 0; i < visibleLandmarks.length; i++) {
    var lm = visibleLandmarks[i];
    var lx = ((lm.year - minYear) / span) * W;
    marks += '<line x1="' + lx + '" y1="' + H + '" x2="' + lx + '" y2="' + (H - 7) + '" class="density-mark-line" />';
  }

  el.innerHTML =
    '<div class="density-chart">' +
      '<svg class="density-svg" viewBox="0 0 ' + W + ' ' + (H + 1) + '" preserveAspectRatio="none">' +
        '<path d="' + path + '" />' +
        ticks +
        marks +
        '<line x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" class="density-baseline" />' +
      '</svg>' +
      '<div class="density-year-labels">' +
        years.map(function (y) {
          var pct = ((y - minYear) / span) * 100;
          return '<span class="density-year" style="left:' + pct.toFixed(1) + '%">\u2019' + String(y).slice(2) + '</span>';
        }).join('') +
      '</div>' +
      (visibleLandmarks.length > 0 ?
        '<div class="density-landmark-labels">' +
          visibleLandmarks.map(function (lm) {
            var pct = ((lm.year - minYear) / span) * 100;
            return '<span class="density-landmark" style="left:' + pct.toFixed(1) + '%">' + lm.label + '</span>';
          }).join('') +
        '</div>'
      : '') +
    '</div>';

  el.querySelector('svg').setAttribute('aria-label',
    years.map(function (y) { return y + ': ' + (yearDist[y] || 0); }).join(', '));

  el.hidden = false;
}
