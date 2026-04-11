// Issue section landing page
// Shows one section of an issue with navigation to other sections
// and prev/next issue links.

import { formatDate, markdownToHtml } from './lib/utils.js';

function renderMarkdown(md) {
  // Use marked if available (loaded async from CDN), otherwise use the
  // built-in converter which handles headings, bold, italic, links,
  // blockquotes, and lists — good enough for graceful degradation.
  if (window.marked) return window.marked(md);
  return markdownToHtml(md);
}

var match = window.location.pathname.match(/\/issues\/issue\/(\d+)/);
if (!match) {
  showError();
} else {
  loadIssue(match[1], window.location.hash.slice(1) || null);
}

async function loadIssue(num, targetSection) {
  try {
    var resp = await fetch('/issues/issue/' + num + '/sections');
    if (!resp.ok) throw new Error('Not found');
    var data = await resp.json();

    document.title = (data.title || 'Issue #' + num) + ' — FLUX Review Search';

    // Meta line
    var meta = document.getElementById('issue-meta');
    meta.textContent = formatDate(data.published_at);

    // Oversized issue number
    document.getElementById('issue-number-hero').textContent = '#' + data.issue_number;

    // Title
    document.getElementById('issue-title').textContent = data.title;

    // Opening quote
    var quoteEl = document.getElementById('issue-quote');
    if (data.opening_quote) {
      quoteEl.textContent = data.opening_quote;
      quoteEl.hidden = false;
    }

    // Prev/next navigation
    var prevLink = document.getElementById('prev-link');
    if (data.prev_issue_number) {
      prevLink.href = '/issues/issue/' + data.prev_issue_number + (targetSection ? '#' + targetSection : '');
      prevLink.hidden = false;
    }
    var nextLink = document.getElementById('next-link');
    if (data.next_issue_number) {
      nextLink.href = '/issues/issue/' + data.next_issue_number + (targetSection ? '#' + targetSection : '');
      nextLink.hidden = false;
    }

    // Substack link
    document.getElementById('substack-link').href = data.canonical_url || '#';

    // Section navigation tabs
    var navEl = document.getElementById('section-nav');
    navEl.innerHTML = data.sections.map(function (s) {
      var isActive = targetSection ? s.type === targetSection : s === data.sections[0];
      return '<button class="section-tab' + (isActive ? ' active' : '') + '" data-type="' + s.type + '">' +
        (s.title || formatSectionType(s.type)) +
        '</button>';
    }).join('');

    // Render the targeted section (or first section)
    var activeSection = targetSection
      ? data.sections.find(function (s) { return s.type === targetSection; })
      : data.sections[0];

    if (activeSection) {
      renderSection(activeSection);
    }

    // Tab click handlers
    navEl.querySelectorAll('.section-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var type = tab.dataset.type;
        var section = data.sections.find(function (s) { return s.type === type; });
        if (!section) return;

        // Update active tab
        navEl.querySelectorAll('.section-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        // Update hash without reload
        history.replaceState(null, '', '#' + type);

        // Update prev/next links to carry section context
        if (data.prev_issue_number) {
          prevLink.href = '/issues/issue/' + data.prev_issue_number + '#' + type;
        }
        if (data.next_issue_number) {
          nextLink.href = '/issues/issue/' + data.next_issue_number + '#' + type;
        }

        renderSection(section);
      });
    });

    document.getElementById('issue-loading').hidden = true;
    document.getElementById('issue-page').hidden = false;
  } catch (err) {
    console.error('Failed to load issue:', err);
    showError();
  }
}

function renderSection(section) {
  var contentEl = document.getElementById('section-content');
  // Re-trigger the CSS fade animation by removing and re-adding the element content
  contentEl.style.animation = 'none';
  contentEl.offsetHeight; // force reflow
  contentEl.style.animation = '';
  var html = renderMarkdown(section.body);
  contentEl.innerHTML =
    '<div class="section-type-label">' + formatSectionType(section.type) + '</div>' +
    (section.title ? '<h2 class="section-heading">' + section.title + '</h2>' : '') +
    '<div class="section-body">' + html + '</div>';
}

function showError() {
  document.getElementById('issue-loading').hidden = true;
  document.getElementById('issue-error').hidden = false;
}

var SECTION_TYPE_LABELS = {
  lead_essay: 'Essay',
  signposts: 'Signposts',
  worth_your_time: 'Worth your time',
  lens: 'Lens of the week',
  book: 'Book',
  postcard: 'Postcard from the future',
  fluxers: 'More from FLUXers',
  other: 'Other',
};

function formatSectionType(type) {
  return SECTION_TYPE_LABELS[type] || type;
}
