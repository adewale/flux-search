/**
 * Centralised emoji handling.
 *
 * The FLUX Review uses emoji prefixes on section headings, signpost items,
 * and titles. This module strips leading emoji sequences so the text content
 * is clean for display and indexing.
 *
 * Handles: basic emoji, variation selectors (U+FE0F), zero-width joiners
 * (U+200D), skin tone modifiers, keycap sequences (1️⃣), and flag sequences.
 */

// Regex that matches leading emoji characters and related codepoints.
// Covers:
//   - Emoticons, symbols, dingbats (U+2000-U+3300)
//   - Supplementary emoji (U+1F000-U+1FFFF)
//   - Variation selectors (U+FE00-U+FE0F)
//   - Zero-width joiner (U+200D)
//   - Combining enclosing keycap (U+20E3)
//   - Skin tone modifiers (U+1F3FB-U+1F3FF)
//   - Regional indicator symbols (U+1F1E0-U+1F1FF)
//   - Tags (U+E0020-U+E007F)
//   - Whitespace between emoji
// Keycap sequences: digit + U+FE0F + U+20E3 (e.g., 2️⃣)
const KEYCAP_RE_SRC = '(?:[0-9#*]\uFE0F?\u20E3)';
// Core emoji characters and modifiers
const EMOJI_CHAR_SRC = '[\u200D\uFE00-\uFE0F\u20E3\u2600-\u27BF\u2B05-\u2B55\u2934-\u2935\u3030\u303D\u3297\u3299\\u{1F000}-\\u{1FFFF}\\u{E0020}-\\u{E007F}]';

const LEADING_EMOJI_RE = new RegExp(`^(?:${KEYCAP_RE_SRC}|${EMOJI_CHAR_SRC}|\\s)+`, 'u');

export function stripEmoji(text: string): string {
  return text.replace(LEADING_EMOJI_RE, '').trim();
}
