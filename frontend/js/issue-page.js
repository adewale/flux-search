// Issue section landing page
// Shows one section of an issue with navigation to other sections
// and prev/next issue links.

import { formatDate, markdownToHtml, renderSectionHtml } from './lib/utils.js';
import { formatSectionLabel as formatSectionType } from './lib/section-labels.js';
import { topicSidePanelHtml, topicMobileDetailsHtml, relatedIssuesMobileDetailsHtml } from './lib/topic-render.js';

function renderMarkdown(md) {
  // Use marked if available (loaded async from CDN) — but only when
  // DOMPurify is too: marked passes raw HTML in the source markdown straight
  // through, and issue bodies are crawled third-party content. Otherwise use
  // the built-in converter, which escapes everything — good enough for
  // graceful degradation.
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked(md));
  }
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
    navEl.setAttribute('role', 'tablist');
    navEl.innerHTML = data.sections.map(function (s) {
      var isActive = targetSection ? s.type === targetSection : s === data.sections[0];
      return '<button class="section-tab' + (isActive ? ' active' : '') + '" role="tab" aria-selected="' + isActive + '" data-type="' + s.type + '">' +
        formatSectionType(s.type) +
        '</button>';
    }).join('');

    // Render the targeted section (or first section)
    var activeSection = targetSection
      ? data.sections.find(function (s) { return s.type === targetSection; })
      : data.sections[0];

    if (activeSection) {
      renderSection(activeSection);
    }

    renderTopics(data.topics || [], data.related_issues || []);

    // Tab click handlers
    navEl.querySelectorAll('.section-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var type = tab.dataset.type;
        var section = data.sections.find(function (s) { return s.type === type; });
        if (!section) return;

        // Update active tab
        navEl.querySelectorAll('.section-tab').forEach(function (t) {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

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

function renderTopics(topics, relatedIssues) {
  var sideEl = document.getElementById('issue-topics-side');
  var mobileEl = document.getElementById('issue-topics-mobile');
  var relatedMobileEl = document.getElementById('issue-related-mobile');
  if (sideEl) {
    sideEl.innerHTML = topicSidePanelHtml(topics, { relatedIssues: relatedIssues });
    sideEl.hidden = topics.length === 0;
  }
  if (mobileEl) {
    mobileEl.innerHTML = topicMobileDetailsHtml(topics);
    mobileEl.hidden = topics.length === 0;
  }
  if (relatedMobileEl) {
    relatedMobileEl.innerHTML = relatedIssuesMobileDetailsHtml(relatedIssues);
    relatedMobileEl.hidden = relatedIssues.length === 0;
  }
}

function renderSection(section) {
  var contentEl = document.getElementById('section-content');
  // Re-trigger the CSS fade animation by removing and re-adding the element content
  contentEl.style.animation = 'none';
  contentEl.offsetHeight; // force reflow
  contentEl.style.animation = '';
  contentEl.innerHTML = renderSectionHtml(section, renderMarkdown);
}

function showError() {
  document.getElementById('issue-loading').hidden = true;
  document.getElementById('issue-error').hidden = false;
}

