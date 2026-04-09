// Issue Reader Pattern
// Fetches and renders a single issue. Independent of search.

import { formatDate, markdownToHtml } from './utils.js';

export function initIssueReader() {
  var loadingEl = document.getElementById('issue-loading');
  var contentEl = document.getElementById('issue-content');
  var errorEl = document.getElementById('issue-error');

  if (!contentEl) return;

  var match = window.location.pathname.match(/\/issues\/issue\/(\d+)/);
  if (!match) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) errorEl.hidden = false;
    return;
  }

  fetchIssue(match[1]);

  async function fetchIssue(num) {
    try {
      var resp = await fetch('/issues/issue/' + num);
      if (!resp.ok) throw new Error('Not found');
      var data = await resp.json();

      document.title = (data.title || 'Issue') + ' — FLUX Review Search';

      document.getElementById('issue-number').textContent = data.issue_number ? '#' + data.issue_number : '';
      document.getElementById('issue-date').textContent = data.published_at ? formatDate(data.published_at) : '';
      document.getElementById('issue-title').textContent = data.title || '';
      document.getElementById('issue-subtitle').textContent = data.subtitle || '';

      var canonLink = document.getElementById('issue-canonical-link');
      canonLink.href = data.canonical_url || data.source_url || '#';

      document.getElementById('issue-body').innerHTML = markdownToHtml(data.body_markdown || '');
      document.getElementById('issue-word-count').textContent = data.word_count ? data.word_count.toLocaleString() + ' words' : '';

      if (loadingEl) loadingEl.hidden = true;
      contentEl.hidden = false;
    } catch (err) {
      console.error('Failed to load issue:', err);
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) errorEl.hidden = false;
    }
  }
}
