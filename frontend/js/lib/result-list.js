// Result List Pattern
// Renders search results with density strip, confidence tiers,
// progressive disclosure, and inline expansion.

import { escapeHtml, escapeHtmlPreserveMark, formatDate, cleanSnippet } from './utils.js';
import { SECTION_LABELS, formatSectionLabel } from './section-labels.js';
import { computeDensityArea } from './density.js';

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
    var title = r.title || 'Untitled';
    var confidenceCls = r.confidence || 'medium';
    var canonicalUrl = r.canonical_url || '';
    var sectionLabel = formatSectionLabel(r.snippet_section);
    var isSemanticOnly = r.matched_by && r.matched_by.length === 1 && r.matched_by[0] === 'vector';

    var issueUrl = r.issue_number
      ? '/issues/issue/' + r.issue_number + (r.snippet_section ? '#' + r.snippet_section : '')
      : escapeHtml(canonicalUrl);

    return '<div class="result-card confidence-' + confidenceCls + '"' +
      (r.snippet_section ? ' data-section="' + r.snippet_section + '"' : '') + '>' +
      '<a href="' + issueUrl + '">' +
        '<div class="result-meta">' +
          (r.issue_number ? '<span class="result-number">#' + r.issue_number + '</span>' : '') +
          (dateStr ? '<span class="result-date">' + dateStr + '</span>' : '') +
          (sectionLabel ? '<span class="result-section">' + sectionLabel + '</span>' : '') +
          (isSemanticOnly ? '<span class="result-semantic">related</span>' : '') +
        '</div>' +
        '<div class="result-title">' + escapeHtml(title) + '</div>' +
        (snippet ? '<p class="result-snippet">' + escapeHtmlPreserveMark(snippet) + '</p>' : '') +
      '</a>' +
    '</div>';
  }).join('');

  // Render section facets if available
  if (data.section_facets && Object.keys(data.section_facets).length > 0) {
    renderSectionFacets(data.section_facets);
  }
}

export function clearResults(container, metaEl, filterChipsEl, emptyStateEl) {
  container.innerHTML = '';
  metaEl.hidden = true;
  filterChipsEl.hidden = true;
  emptyStateEl.hidden = true;
  var densityEl = document.getElementById('density-strip');
  if (densityEl) densityEl.hidden = true;
  var facetsEl = document.getElementById('section-facets');
  if (facetsEl) facetsEl.hidden = true;
}

export function renderPagination(el, currentPage, totalPages, onPageChange) {
  if (!el) return;

  var buttons = [];

  if (currentPage > 1) {
    buttons.push('<button class="page-btn" data-page="' + (currentPage - 1) + '">\u2190 Prev</button>');
  }

  buttons.push('<span class="page-info">' + currentPage + ' / ' + totalPages + '</span>');

  if (currentPage < totalPages) {
    buttons.push('<button class="page-btn" data-page="' + (currentPage + 1) + '">Next \u2192</button>');
  }

  el.innerHTML = buttons.join('');
  el.hidden = false;

  el.querySelectorAll('.page-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      onPageChange(parseInt(btn.dataset.page));
    });
  });
}

// Archive landmarks — story beats that give temporal orientation
var LANDMARKS = [
  { year: 2021, label: '#1' },
  { year: 2022, label: '#50' },
  { year: 2023, label: '#100' },
  { year: 2025, label: '#200' },
];

function renderDensityStrip(yearDist) {
  var el = document.getElementById('density-strip');
  if (!el) return;

  var W = 300;
  var H = 48;
  var data = computeDensityArea(yearDist, W, H);
  if (data.points.length === 0) return;

  var span = data.maxYear - data.minYear || 1;
  var effectiveMax = Math.max(data.maxCount, 5);

  // Area path — connected fill, one point per year
  var pathD = 'M0,' + H + ' L' +
    data.points.map(function (p) { return p.x + ',' + p.y; }).join(' L') +
    ' L' + W + ',' + H + ' Z';

  // Year ticks
  var ticks = data.allYears.map(function (y) {
    var tx = ((y - data.minYear) / span) * W;
    return '<line x1="' + tx + '" y1="' + H + '" x2="' + tx + '" y2="' + (H - 4) + '" class="density-tick" />';
  }).join('');

  // Landmark markers
  var visibleLandmarks = LANDMARKS.filter(function (lm) {
    return lm.year >= data.minYear && lm.year <= data.maxYear;
  });
  var marks = visibleLandmarks.map(function (lm) {
    var lx = ((lm.year - data.minYear) / span) * W;
    return '<line x1="' + lx + '" y1="' + H + '" x2="' + lx + '" y2="' + (H - 7) + '" class="density-mark-line" />';
  }).join('');

  // Range-frame Y-axis: line from data min to data max, labels at endpoints.
  // Only the range that contains data is drawn — pure data-ink.
  var minCount = Math.min.apply(null, Object.values(yearDist));
  var minY = H - (minCount / effectiveMax) * H;
  var maxY = H - (data.maxCount / effectiveMax) * H;
  var rangeFrame =
    '<line x1="0" y1="' + minY + '" x2="0" y2="' + maxY + '" class="density-range-axis" />' +
    '<line x1="-2" y1="' + maxY + '" x2="2" y2="' + maxY + '" class="density-range-tick" />' +
    '<line x1="-2" y1="' + minY + '" x2="2" y2="' + minY + '" class="density-range-tick" />';

  el.innerHTML =
    '<div class="density-chart">' +
      '<div class="density-range-labels">' +
        '<span class="density-range-max" style="top:' + maxY + 'px">' + data.maxCount + '</span>' +
        (minCount !== data.maxCount ? '<span class="density-range-min" style="top:' + minY + 'px">' + minCount + '</span>' : '') +
      '</div>' +
      '<div class="density-area">' +
        '<svg class="density-svg" viewBox="-3 0 ' + (W + 6) + ' ' + (H + 1) + '" preserveAspectRatio="none">' +
          rangeFrame +
          '<path d="' + pathD + '" />' +
          ticks +
          marks +
          '<line x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" class="density-baseline" />' +
        '</svg>' +
        '<div class="density-year-labels">' +
          data.allYears.map(function (y) {
            var pct = ((y - data.minYear) / span) * 100;
            return '<span class="density-year" style="left:' + pct.toFixed(1) + '%">\u2019' + String(y).slice(2) + '</span>';
          }).join('') +
        '</div>' +
        (visibleLandmarks.length > 0 ?
          '<div class="density-landmark-labels">' +
            visibleLandmarks.map(function (lm) {
              var pct = ((lm.year - data.minYear) / span) * 100;
              return '<span class="density-landmark" style="left:' + pct.toFixed(1) + '%">' + lm.label + '</span>';
            }).join('') +
          '</div>'
        : '') +
      '</div>' +
    '</div>';

  el.querySelector('svg').setAttribute('aria-label',
    data.allYears.map(function (y) { return y + ': ' + (yearDist[y] || 0); }).join(', '));

  el.hidden = false;
}


function renderSectionFacets(facets) {
  var el = document.getElementById('section-facets');
  if (!el) return;

  var items = Object.entries(facets)
    .sort(function (a, b) { return b[1] - a[1]; })
    .map(function (pair) {
      var label = SECTION_LABELS[pair[0]] || pair[0];
      return '<button class="facet" data-section="' + pair[0] + '">' +
        label + ' <span class="facet-count">' + pair[1] + '</span></button>';
    });

  if (items.length > 0) {
    el.innerHTML = items.join('');
    el.hidden = false;

    // Clicking a facet dispatches a custom event for the app router to handle
    el.querySelectorAll('.facet').forEach(function (btn) {
      btn.addEventListener('click', function () {
        el.dispatchEvent(new CustomEvent('facet-click', {
          bubbles: true,
          detail: { section: btn.dataset.section },
        }));
      });
    });
  }
}
