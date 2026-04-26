import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

const CONFIG_PATH = new URL('../wrangler.jsonc', import.meta.url);

function stripJsonComments(jsonc: string): string {
  return jsonc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function configuredCron(): string {
  const config = JSON.parse(stripJsonComments(readFileSync(CONFIG_PATH, 'utf8')));
  return config.triggers.crons[0];
}

function cloudflareDayOfWeek(token: string): number {
  const names: Record<string, number> = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };

  const upper = token.toUpperCase();
  if (upper in names) return names[upper];

  const numeric = Number.parseInt(token, 10);
  if (numeric < 1 || numeric > 7) throw new Error(`Unsupported Cloudflare cron day-of-week: ${token}`);

  return (numeric + 6) % 7;
}

function cronMatchesUtcDate(cron: string, date: Date): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);

  return minute === String(date.getUTCMinutes())
    && hour === String(date.getUTCHours())
    && dayOfMonth === '*'
    && month === '*'
    && cloudflareDayOfWeek(dayOfWeek) === date.getUTCDay();
}

describe('weekly sync cron schedule', () => {
  it('documents the Cloudflare numeric day mapping that made 6 fire on Friday', () => {
    expect(cloudflareDayOfWeek('6')).toBe(5);
    expect(cloudflareDayOfWeek('7')).toBe(6);
    expect(cloudflareDayOfWeek('SAT')).toBe(6);
  });

  it('matches Saturday 25 April 2026 at 06:00 UTC', () => {
    const saturdayRun = new Date('2026-04-25T06:00:00Z');
    const fridayRun = new Date('2026-04-24T06:00:00Z');

    expect(configuredCron()).toBe('0 6 * * SAT');
    expect(cronMatchesUtcDate(configuredCron(), saturdayRun)).toBe(true);
    expect(cronMatchesUtcDate(configuredCron(), fridayRun)).toBe(false);
  });

  it('only matches Saturdays at the configured UTC time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 364 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (dayOffset, hour, minute) => {
          const date = new Date(Date.UTC(2026, 0, 1 + dayOffset, hour, minute));
          const matches = cronMatchesUtcDate(configuredCron(), date);

          expect(matches).toBe(date.getUTCDay() === 6 && hour === 6 && minute === 0);
        }
      ),
      { numRuns: 500 }
    );
  });
});
