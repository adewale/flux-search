import type { SearchFilters } from '../db/types';

export interface ParsedQuery {
  freeText: string;
  phrases: string[];
  filters: SearchFilters;
  operators: string[];
}

const MAX_QUERY_LENGTH = 500;

const VALID_OPERATORS = new Set([
  'before', 'after', 'year', 'issue',
]);

export function parseQuery(raw: string): ParsedQuery {
  const input = raw.slice(0, MAX_QUERY_LENGTH).trim();

  const phrases: string[] = [];
  const operators: string[] = [];
  const filters: SearchFilters = {};

  // Extract quoted phrases
  let remaining = input.replace(/"([^"]+)"/g, (_match, phrase) => {
    phrases.push(phrase);
    return '';
  });

  // Extract operators (word:value patterns)
  // Unrecognized operators are left as free text for FTS
  remaining = remaining.replace(/(\w+):(\S+)/g, (_match, key: string, value: string) => {
    const lowerKey = key.toLowerCase();

    if (!VALID_OPERATORS.has(lowerKey)) {
      return _match; // leave in free text
    }

    operators.push(`${key}:${value}`);

    switch (lowerKey) {
      case 'before': {
        const date = parseDate(value);
        if (date) filters.before = date;
        break;
      }
      case 'after': {
        const date = parseDate(value);
        if (date) filters.after = date;
        break;
      }
      case 'year': {
        const y = parseInt(value);
        if (!isNaN(y) && y >= 2000 && y <= 2100) filters.year = y;
        break;
      }
      case 'issue': {
        const n = parseInt(value);
        if (!isNaN(n) && n > 0) filters.issueNumber = n;
        break;
      }
    }

    return '';
  });

  const freeText = remaining.replace(/\s+/g, ' ').trim();

  return { freeText, phrases, filters, operators };
}

function parseDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Roundtrip through Date to reject impossible dates like Feb 30
    const d = new Date(value + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    const roundtrip = d.toISOString().split('T')[0];
    if (roundtrip === value) return value;
    return null;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const month = parseInt(value.split('-')[1]);
    if (month >= 1 && month <= 12) return `${value}-01`;
  }
  if (/^\d{4}$/.test(value)) {
    return `${value}-01-01`;
  }
  return null;
}
