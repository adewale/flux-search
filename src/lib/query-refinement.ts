/**
 * Append or replace an operator in a search query string.
 * Prevents duplication when clicking refinement buttons multiple times.
 */

export function appendOperator(query: string, operator: string): string {
  const [key] = operator.split(':');
  // Remove any existing instance of this operator type
  const cleaned = query.replace(new RegExp(`\\b${key}:\\S+`, 'g'), '').replace(/\s+/g, ' ').trim();
  return (cleaned + ' ' + operator).trim();
}
