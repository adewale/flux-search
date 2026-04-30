export type CleanText = string & { readonly __brand: 'CleanText' };

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function cleanTextFromHtml(input: string): CleanText {
  let text = String(input ?? '');
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeBasicEntities(text);
  // Entity decoding can reveal escaped tags. Remove tag-shaped text while
  // preserving comparison prose such as "A < B > C".
  text = text.replace(/<\/?[a-z][a-z0-9]*(?:\s+[^>]*)?>/gi, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text as CleanText;
}

export function cleanTextFromPlain(input: string): CleanText {
  return cleanTextFromHtml(input);
}
