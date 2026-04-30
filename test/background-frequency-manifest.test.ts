import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

describe('background frequency manifest', () => {
  it('matches the generated frequency table and preserves attribution metadata', () => {
    const manifest = JSON.parse(readFileSync('data/background/manifest.json', 'utf8'));
    const generated = readFileSync(manifest.output, 'utf8');
    const hash = createHash('sha256').update(generated).digest('hex');

    expect(manifest.output_sha256).toBe(hash);
    expect(manifest.source_package).toBe('nodewordfreq');
    expect(manifest.runtime_dependency).toBe(false);
    expect(manifest.attribution).toBe('docs/background-frequency-attribution.md');
  });
});
