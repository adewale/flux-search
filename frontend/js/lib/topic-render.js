/**
 * Pure HTML-string renderers for topic surfaces. Kept as pure functions so
 * they can be unit-tested without a DOM, matching the pattern used by
 * `density.js` (geometry math) elsewhere in the app.
 *
 * The renderers escape user-controlled strings; callers must NOT pre-escape.
 * Consistent with `escapeHtml` in lib/utils.js — duplicated here to keep
 * this module dependency-free for ease of testing.
 */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a horizontal row of chip-shaped links for an issue's topics.
 * Each chip links to /search?q=topic:"<keyword>"  so a click drills into
 * issues sharing that topic.
 *
 * - Returns '' for empty/missing topics. The caller decides how to handle
 *   the blank state (hide container, fall back to a placeholder, etc.).
 * - `max` clamps the chip count.
 */
export function topicChipsHtml(topics, opts) {
  if (!Array.isArray(topics) || topics.length === 0) return '';
  var max = (opts && Number.isFinite(opts.max)) ? opts.max : 5;
  var className = (opts && opts.className) || 'topic-chip';

  return topics.slice(0, max).map(function (t) {
    if (typeof t === 'string') {
      if (!t) return '';
      var href0 = '/search?q=' + encodeURIComponent('topic:"' + t + '"');
      return '<a class="' + className + '" href="' + href0 + '">' + escapeHtml(t) + '</a>';
    }
    // Object form: keyword is the canonical, lowercased form. Without it,
    // a topic chip can't link back into search — drop the row entirely.
    var keyword = t.keyword || '';
    if (!keyword) return '';
    var display = t.keyword_display || keyword;
    var href = '/search?q=' + encodeURIComponent('topic:"' + keyword + '"');
    return '<a class="' + className + '" href="' + href + '">' +
      escapeHtml(display) + '</a>';
  }).filter(Boolean).join('');
}

/**
 * Render the issue-page side panel. Wraps an `<aside>` (sticky on desktop)
 * around the chip list; CSS owns the breakpoint behaviour.
 *
 * Returns '' when there are no topics so the caller can hide the panel.
 */
export function topicSidePanelHtml(topics) {
  if (!Array.isArray(topics) || topics.length === 0) return '';
  return '<aside class="issue-topics-panel" aria-label="Topics in this issue">' +
    '<h3 class="issue-topics-title">Topics</h3>' +
    '<div class="issue-topics-chips">' + topicChipsHtml(topics, { max: 12 }) + '</div>' +
    '</aside>';
}

/**
 * Mobile-only inline collapsed form: a `<details>` element so it can be
 * toggled without JS. Same data, different chrome.
 */
export function topicMobileDetailsHtml(topics) {
  if (!Array.isArray(topics) || topics.length === 0) return '';
  return '<details class="issue-topics-mobile">' +
    '<summary>Topics in this issue</summary>' +
    '<div class="issue-topics-chips">' + topicChipsHtml(topics, { max: 12 }) + '</div>' +
    '</details>';
}

/**
 * Landing-page "Recurring themes" strip. `corpusTopics` is the array
 * returned by GET /topics. Each theme links to its /topics/:keyword page.
 *
 * Returns '' when the corpus has no aggregated topics yet.
 */
export function topicLandingStripHtml(corpusTopics) {
  if (!Array.isArray(corpusTopics) || corpusTopics.length === 0) return '';
  var top = corpusTopics.slice(0, 12);
  var chips = top.map(function (t) {
    var keyword = t.keyword || t.keyword_display || '';
    var display = t.keyword_display || t.keyword || '';
    if (!keyword) return '';
    var href = '/topics/' + encodeURIComponent(keyword);
    var freq = t.doc_frequency != null ? ' <span class="theme-freq">' + escapeHtml(String(t.doc_frequency)) + '</span>' : '';
    return '<a class="theme-chip" href="' + href + '">' + escapeHtml(display) + freq + '</a>';
  }).filter(Boolean).join('');

  return '<section class="recurring-themes" aria-label="Recurring themes">' +
    '<h2 class="recurring-themes-title">Recurring themes</h2>' +
    '<div class="recurring-themes-strip">' + chips + '</div>' +
    '</section>';
}

/**
 * /topics page: full corpus list with frequency. Unlike the landing strip
 * it lists everything and does no slicing.
 *
 * Each row is annotated with the topic's confidence tier (high/medium/low)
 * so CSS can shade lower-confidence entries lighter without baking
 * thresholds into the DOM.
 */
export function topicsIndexHtml(corpusTopics) {
  if (!Array.isArray(corpusTopics) || corpusTopics.length === 0) {
    return '<p class="topics-empty">No topics yet.</p>';
  }
  var rows = corpusTopics.map(function (t) {
    var keyword = t.keyword || '';
    var display = t.keyword_display || t.keyword || '';
    if (!keyword) return '';
    var href = '/topics/' + encodeURIComponent(keyword);
    var conf = t.confidence ? ' confidence-' + t.confidence : '';
    var burst = (typeof t.burst_score === 'number' && t.burst_score >= 2)
      ? ' <span class="topics-row-burst" title="Concentrated in ' +
        escapeHtml(t.burst_quarter || '') + '">burst</span>'
      : '';
    return '<li class="topics-row' + conf + '">' +
      '<a class="topics-row-link" href="' + href + '">' + escapeHtml(display) + '</a>' +
      ' <span class="topics-row-freq">' + escapeHtml(String(t.doc_frequency || 0)) + '</span>' +
      burst +
      '</li>';
  }).filter(Boolean).join('');
  return '<ul class="topics-index">' + rows + '</ul>';
}
