// Result List Pattern
// Renders search results with density strip, confidence tiers,
// progressive disclosure, and inline expansion.

import { escapeHtml, escapeHtmlPreserveMark, formatDate, cleanSnippet } from './utils.js';

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
    var quote = r.opening_quote || '';
    var canonicalUrl = r.canonical_url || '';

    var sectionLabel = formatSectionLabel(r.snippet_section);

    return '<div class="result-card confidence-' + confidenceCls + '">' +
      '<a href="' + escapeHtml(canonicalUrl) + '" target="_blank" rel="noopener">' +
        '<div class="result-meta">' +
          (r.issue_number ? '<span class="result-number">#' + r.issue_number + '</span>' : '') +
          (dateStr ? '<span class="result-date">' + dateStr + '</span>' : '') +
          (sectionLabel ? '<span class="result-section">' + sectionLabel + '</span>' : '') +
        '</div>' +
        '<div class="result-title">' + escapeHtml(title) + '</div>' +
        (quote ? '<p class="result-quote">' + escapeHtml(quote.length > 120 ? quote.slice(0, 120) + '...' : quote) + '</p>' : '') +
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

var SECTION_LABELS = {
  lead_essay: 'Essay',
  signposts: 'Signposts',
  worth_your_time: 'Worth your time',
  lens: 'Lens',
  book: 'Book',
  postcard: 'Postcard',
  fluxers: 'FLUXers',
  body: 'Body',
  title_summary: 'Title',
};

function formatSectionLabel(section) {
  if (!section) return null;
  // Match against known section names (may be emoji-prefixed from chunk labels)
  var lower = section.toLowerCase();
  for (var key in SECTION_LABELS) {
    if (lower.includes(key) || lower === key) return SECTION_LABELS[key];
  }
  // Try to clean up the raw label
  if (section.length > 30) return null;
  return section.replace(/^[\u{1F000}-\u{1FFFF}\uFE0F\u200D\s]+/u, '').trim() || null;
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
