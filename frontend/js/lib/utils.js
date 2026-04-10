// Shared utilities — the "atoms" that patterns compose from

export function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

// Strip Substack boilerplate from titles
export function cleanTitle(title) {
  return title
    .replace(/^[\u{1F300}\u{1F5DE}\s]+/u, '')
    .replace(/\s*-\s*by\s+The\s+FLUX\s+Collective$/i, '')
    .trim();
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
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
