/**
 * Centralised emoji handling tests.
 * The codebase has emoji stripping in 3+ places — consolidate and test aggressively.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { stripEmoji } from '../src/lib/emoji';

describe('stripEmoji', () => {
  // Real FLUX Review examples that have failed before
  it('strips 🌱🏗️ prefix', () => {
    expect(stripEmoji('🌱🏗️ Just enough structure')).toBe('Just enough structure');
  });

  it('strips 🌀🗞 prefix', () => {
    expect(stripEmoji('🌀🗞 The FLUX Review')).toBe('The FLUX Review');
  });

  it('strips 🦉🔮 prefix', () => {
    expect(stripEmoji('🦉🔮 Preserving the future')).toBe('Preserving the future');
  });

  it('strips ‍🔥🔗 with ZWJ sequences', () => {
    expect(stripEmoji('‍🔥🔗 The bonds of fate')).toBe('The bonds of fate');
  });

  it('strips 🕵️‍♀️📆 with gender modifier', () => {
    expect(stripEmoji('🕵️‍♀️📆 Lens of the week')).toBe('Lens of the week');
  });

  it('strips 2️⃣0️⃣2️⃣2️⃣ keycap sequences', () => {
    expect(stripEmoji('2️⃣0️⃣2️⃣2️⃣ What a year')).toBe('What a year');
  });

  it('strips 🚏🏛️ signpost emoji', () => {
    expect(stripEmoji('🚏🏛️ There are now crypto coins')).toBe('There are now crypto coins');
  });

  it('strips ‍🌫️🕴️ with ZWJ', () => {
    expect(stripEmoji('‍🌫️🕴️ The disappearing problem')).toBe('The disappearing problem');
  });

  it('preserves plain text', () => {
    expect(stripEmoji('Just plain text')).toBe('Just plain text');
  });

  it('preserves text with numbers', () => {
    expect(stripEmoji('Issue 198')).toBe('Issue 198');
  });

  it('handles empty string', () => {
    expect(stripEmoji('')).toBe('');
  });

  it('handles all-emoji string', () => {
    const result = stripEmoji('🌀🗞🔥');
    expect(result).toBe('');
  });

  it('strips emoji from middle of string (only leading)', () => {
    // stripEmoji should only strip LEADING emoji, not mid-text
    expect(stripEmoji('Hello 🌍 world')).toBe('Hello 🌍 world');
  });

  // PBT: output never starts with emoji
  it('PBT: output never starts with an emoji codepoint', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (input) => {
        const result = stripEmoji(input);
        if (result.length > 0) {
          const firstCodePoint = result.codePointAt(0)!;
          // Common emoji ranges: U+1F000-U+1FFFF, U+2600-U+27BF, U+FE00-U+FE0F
          const isEmoji = (firstCodePoint >= 0x1F000 && firstCodePoint <= 0x1FFFF) ||
                          (firstCodePoint >= 0x2600 && firstCodePoint <= 0x27BF);
          expect(isEmoji).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  // PBT: stripping is idempotent
  it('PBT: stripping twice gives same result as once', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (input) => {
        expect(stripEmoji(stripEmoji(input))).toBe(stripEmoji(input));
      }),
      { numRuns: 200 }
    );
  });

  // PBT: output is always a suffix of (trimmed) input or empty
  it('PBT: plain ASCII text passes through unchanged', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 .,!?'-]*[a-zA-Z0-9.,!?']$/),
        (input) => {
          expect(stripEmoji(input)).toBe(input);
        }
      ),
      { numRuns: 200 }
    );
  });
});
