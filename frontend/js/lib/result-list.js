// Result List Pattern
// Renders search results with density strip, confidence tiers,
// progressive disclosure, and inline expansion.

import { escapeHtml, escapeHtmlPreserveMark, formatDate, cleanSnippet } from './utils.js';
import { SECTION_LABELS, formatSectionLabel } from './section-labels.js';
import { computeDensityBars } from './density.js';

export function renderResults(container, metaEl, countEl, invalidOpsEl, filterChipsEl, data, opts) {
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

  if (!opts || !opts.skipDensity) {
    var qd = data.quarter_distribution || data.year_distribution;
    if (qd && Object.keys(qd).length > 0) {
      renderDensityStrip(qd);
    }
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

export function clearResults(container, metaEl, filterChipsEl, emptyStateEl, opts) {
  container.innerHTML = '';
  metaEl.hidden = true;
  filterChipsEl.hidden = true;
  emptyStateEl.hidden = true;
  // Only clear density strip and facets on new queries, not pagination
  if (!opts || !opts.keepDensity) {
    var densityEl = document.getElementById('density-strip');
    if (densityEl) { var content = document.getElementById('density-content'); if (content) content.innerHTML = ''; densityEl.hidden = true; }
    var facetsEl = document.getElementById('section-facets');
    if (facetsEl) facetsEl.hidden = true;
  }
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

function renderDensityStrip(dist) {
  var panel = document.getElementById('density-strip');
  var el = document.getElementById('density-content') || panel;
  if (!el) return;

  var W = 300;
  var H = 48;
  var data = computeDensityBars(dist, W, H);
  if (data.bars.length === 0) return;

  // Stacked bars with section-type colors
  var barsSvg = data.bars.map(function (b) {
    var bx = b.x - data.barWidth / 2;
    var baseY = H;
    return b.segments.map(function (seg) {
      var segY = baseY - seg.y - seg.height;
      return '<rect x="' + bx + '" y="' + segY + '" width="' + data.barWidth +
        '" height="' + seg.height + '" class="density-bar density-section-' + seg.section + '" />';
    }).join('');
  }).join('');

  // Year tick lines
  var ticks = data.yearTicks.map(function (t) {
    return '<line x1="' + t.x + '" y1="' + H + '" x2="' + t.x + '" y2="' + (H - 4) + '" class="density-tick" />';
  }).join('');

  // Milestone annotations
  var milestones = LANDMARKS.filter(function (lm) {
    var lmPos = lm.year;
    var minPos = data.yearTicks.length > 0 ? data.yearTicks[0].year : 0;
    var maxYear = data.yearTicks.length > 0 ? data.yearTicks[data.yearTicks.length - 1].year : 0;
    return lmPos >= minPos && lmPos <= maxYear;
  }).map(function (lm) {
    var minPos = data.yearTicks[0].year;
    var maxPos = new Date().getFullYear() + Math.floor(new Date().getMonth() / 3) * 0.25;
    var span = maxPos - minPos || 1;
    var lx = ((lm.year - minPos) / span) * W;
    return '<line x1="' + lx + '" y1="0" x2="' + lx + '" y2="' + H + '" class="density-milestone" />' +
      '<text x="' + lx + '" y="-2" class="density-milestone-label">' + lm.label + '</text>';
  }).join('');

  // Tooltip hit areas (invisible rects that show tooltips on hover)
  var tooltips = data.bars.map(function (b) {
    var bx = b.x - data.barWidth / 2 - 2;
    var parts = b.key.split('-Q');
    var label = 'Q' + parts[1] + ' ' + parts[0];
    var sectionList = b.segments.map(function (s) {
      return formatSectionLabel(s.section) + ': ' + s.count;
    }).join(', ');
    var title = label + ' — ' + b.totalCount + ' result' + (b.totalCount !== 1 ? 's' : '') +
      (b.segments.length > 1 ? ' (' + sectionList + ')' : '');
    return '<rect x="' + bx + '" y="0" width="' + (data.barWidth + 4) +
      '" height="' + H + '" class="density-tooltip-area"><title>' + title + '</title></rect>';
  }).join('');

  el.innerHTML =
    '<div class="density-chart">' +
      '<svg class="density-svg" viewBox="-5 -10 ' + (W + 10) + ' ' + (H + 11) + '">' +
        milestones +
        barsSvg +
        tooltips +
        ticks +
        '<line x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" class="density-baseline" />' +
      '</svg>' +
      '<div class="density-year-labels">' +
        data.yearTicks.map(function (t) {
          var pct = (t.x / W) * 100;
          return '<span class="density-year" style="left:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%">\u2019' + String(t.year).slice(2) + '</span>';
        }).join('') +
      '</div>' +
    '</div>';

  el.querySelector('svg').setAttribute('aria-label',
    data.bars.map(function (b) { return b.key + ': ' + b.totalCount; }).join(', '));

  if (panel) panel.hidden = false;
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
