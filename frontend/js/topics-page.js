// /topics index + /topics/:keyword detail page.
//
// One page handles both routes. The path is parsed at module load:
//   /topics            → index of all corpus topics
//   /topics/<keyword>  → detail page for that keyword
import { topicsIndexHtml } from './lib/topic-render.js';
import { formatDate } from './lib/utils.js';
import { topicSparklineSvg } from './lib/topic-sparkline.js';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var pathMatch = window.location.pathname.match(/^\/topics(?:\/(.+))?$/);
if (pathMatch && pathMatch[1]) {
  loadTopicDetail(decodeURIComponent(pathMatch[1]));
} else {
  loadTopicsIndex();
}

async function loadTopicsIndex() {
  try {
    var sortParam = new URLSearchParams(window.location.search).get('sort') || 'frequency';
    var resp = await fetch('/topics?sort=' + encodeURIComponent(sortParam) + '&limit=200');
    var data = await resp.json();
    var indexEl = document.getElementById('topics-index');
    if (!indexEl) return;
    indexEl.innerHTML = topicsIndexHtml(data.topics || []);
  } catch (e) {
    console.error('Topics index failed:', e);
  }
}

async function loadTopicDetail(keyword) {
  try {
    var resp = await fetch('/topics/' + encodeURIComponent(keyword));
    if (!resp.ok) {
      showNotFound(keyword);
      return;
    }
    var data = await resp.json();

    document.title = (data.keyword_display || data.keyword) + ' — Topics — FLUX Review Search';

    var titleEl = document.getElementById('topics-page-title');
    if (titleEl) titleEl.textContent = data.keyword_display || data.keyword;

    var detailEl = document.getElementById('topics-detail');
    var indexEl = document.getElementById('topics-index');
    if (indexEl) indexEl.hidden = true;
    if (!detailEl) return;

    var freq = data.doc_frequency != null
      ? '<p class="topics-detail-meta">' + escapeHtml(String(data.doc_frequency)) +
        ' issue' + (data.doc_frequency === 1 ? '' : 's') + '</p>'
      : '';

    var sparkline = data.timeline && data.timeline.length > 0
      ? '<div class="topic-sparkline-host" aria-label="Mentions over time">' +
        topicSparklineSvg(data.timeline, { width: 320, height: 36 }) +
        '</div>'
      : '';

    var adjacent = (data.adjacent || []).length > 0
      ? '<aside class="topic-adjacent" aria-label="Related topics">' +
        '<h3 class="topic-adjacent-title">Frequently appears with</h3>' +
        '<div class="topic-adjacent-chips">' +
        data.adjacent.map(function (a) {
          var k = a.keyword || '';
          var d = a.keyword_display || k;
          if (!k) return '';
          return '<a class="topic-chip" href="/topics/' + encodeURIComponent(k) +
            '">' + escapeHtml(d) + ' <span class="theme-freq">' + escapeHtml(String(a.cooccurrence)) + '</span></a>';
        }).filter(Boolean).join('') +
        '</div>' +
        '</aside>'
      : '';

    var issueRows = (data.issues || []).map(function (i) {
      var date = i.published_at ? formatDate(i.published_at) : '';
      var num = i.issue_number ? '#' + i.issue_number : '';
      var href = i.issue_number ? '/issues/issue/' + i.issue_number : (i.canonical_url || '#');
      return '<li class="topic-issue-row">' +
        '<a href="' + escapeHtml(href) + '">' +
          (num ? '<span class="topic-issue-number">' + escapeHtml(num) + '</span>' : '') +
          (date ? '<span class="topic-issue-date">' + escapeHtml(date) + '</span>' : '') +
          '<span class="topic-issue-title">' + escapeHtml(i.title || '') + '</span>' +
        '</a>' +
        '</li>';
    }).join('');

    detailEl.innerHTML =
      freq +
      sparkline +
      '<a class="topics-search-link" href="/search?q=' +
        encodeURIComponent('topic:"' + data.keyword + '"') + '">Search this topic</a>' +
      adjacent +
      (issueRows ? '<ul class="topic-issues-list">' + issueRows + '</ul>' : '');
    detailEl.hidden = false;
  } catch (e) {
    console.error('Topic detail failed:', e);
    showNotFound(keyword);
  }
}

function showNotFound(keyword) {
  var detailEl = document.getElementById('topics-detail');
  if (!detailEl) return;
  detailEl.innerHTML = '<p class="empty-heading">Topic not found: ' +
    escapeHtml(keyword) + '</p><p><a href="/topics">All topics</a></p>';
  detailEl.hidden = false;
}
