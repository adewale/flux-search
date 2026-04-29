/**
 * Burst score: how concentrated a topic is in time.
 *
 * A plain document-frequency threshold treats every df=5 topic the same.
 * That's information loss: a topic with df=4 spread evenly over four
 * years is a slow burn; df=4 in one quarter is a story. The burst score
 * surfaces the difference.
 *
 *   share(q) = occurrences(q) / total_occurrences
 *   burst    = max(share) / mean(share)
 *
 * For a topic that's perfectly uniform across N quarters, burst = 1.
 * For a topic that shows up in one quarter only, burst = N. We also
 * record the quarter that produced the max share (`burst_quarter`).
 *
 * Pure function — no DB dependency, easy to unit-test.
 */

export interface TimelineRow {
  year: number;
  month: number;
  occurrences: number;
}

export interface BurstResult {
  burstScore: number;
  burstQuarter: string | null;
  /** total occurrences, as a sanity-check for callers. */
  total: number;
}

function quarterKey(year: number, month: number): string {
  const q = Math.floor((Math.max(1, Math.min(12, month)) - 1) / 3) + 1;
  return year + '-Q' + q;
}

function quarterIndex(year: number, month: number): number {
  return year * 4 + Math.floor((Math.max(1, Math.min(12, month)) - 1) / 3);
}

function indexToQuarterKey(idx: number): string {
  const year = Math.floor(idx / 4);
  const q = (idx % 4) + 1;
  return year + '-Q' + q;
}

export function computeBurstScore(timeline: TimelineRow[]): BurstResult {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { burstScore: 0, burstQuarter: null, total: 0 };
  }

  // Aggregate to quarters first — month-grain bursts are too noisy for
  // a weekly-cadence newsletter.
  const byQuarter = new Map<number, number>();
  let total = 0;
  let minIdx = Number.POSITIVE_INFINITY;
  let maxIdx = Number.NEGATIVE_INFINITY;
  for (const row of timeline) {
    const idx = quarterIndex(row.year, row.month);
    byQuarter.set(idx, (byQuarter.get(idx) ?? 0) + row.occurrences);
    total += row.occurrences;
    if (row.occurrences > 0) {
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }
  }

  if (total === 0 || byQuarter.size === 0 || !isFinite(minIdx)) {
    return { burstScore: 0, burstQuarter: null, total };
  }

  let burstIdx: number | null = null;
  let maxOcc = 0;
  for (const [idx, occ] of byQuarter) {
    if (occ > maxOcc) { maxOcc = occ; burstIdx = idx; }
  }

  // Denominator counts the full span between first and last appearance,
  // including silent quarters in between. This makes a single-quarter
  // spike against three silent neighbours produce burst ≈ 4, not 1.
  const span = maxIdx - minIdx + 1;
  const meanOcc = total / span;
  const burstScore = meanOcc > 0 ? maxOcc / meanOcc : 0;

  return {
    burstScore,
    burstQuarter: burstIdx !== null ? indexToQuarterKey(burstIdx) : null,
    total,
  };
}
