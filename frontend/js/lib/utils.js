// Shared utilities — the "atoms" that patterns compose from

// Pure string escaping — no DOM dependency, so it runs in unit tests and
// can be shared by every module. Escapes quotes too (the old DOM-based
// version didn't), making it safe for attribute contexts.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape HTML but preserve <mark>...</mark> tags from FTS highlighting
export function escapeHtmlPreserveMark(str) {
  // Replace <mark>/<\/mark> with placeholders, escape, then restore
  var text = str
    .replace(/<mark>/g, '\x00MARK_OPEN\x00')
    .replace(/<\/mark>/g, '\x00MARK_CLOSE\x00');
  text = escapeHtml(text);
  return text
    .replace(/\x00MARK_OPEN\x00/g, '<mark>')
    .replace(/\x00MARK_CLOSE\x00/g, '</mark>');
}

export function formatDate(dateStr) {
  try {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

// Strip Substack metadata junk from snippets
export function cleanSnippet(snippet) {
  return snippet
    .replace(/\[.*?\]\(https?:\/\/[^)]+\)/g, '')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\d*Share/gi, '')
    .replace(/\$s_![^!]+!/g, '')
    .replace(/https?:\/\/substackcdn\.com\S*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function markdownToHtml(md) {
  var html = escapeHtml(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links: only http(s), site-relative, and fragment targets become anchors.
  // Anything else (javascript:, data:, ...) renders as plain text — issue
  // bodies are crawled third-party content.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, text, url) {
    if (/^(https?:\/\/|\/|#)/i.test(url)) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
    }
    return text;
  });
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  return html;
}

// Issue-page section content. The title is stored newsletter content, so it
// is escaped; the body goes through the caller's markdown renderer (the
// issue page passes its sanitizing renderer) or the built-in escaping
// converter above.
export function renderSectionHtml(section, markdownRenderer) {
  var render = markdownRenderer || markdownToHtml;
  var heading = section.title
    ? '<h2 class="section-heading">' + escapeHtml(section.title) + '</h2>'
    : '';
  return heading + '<div class="section-body">' + render(section.body || '') + '</div>';
}
