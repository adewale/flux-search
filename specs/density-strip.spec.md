# Density Strip Specification

The density strip is a bar chart showing how search results are distributed over time. It appears in a bordered panel above the search results for user-driven queries.

## Data

- **X-axis:** Quarters (Q1-Q4 per year), from the earliest result to the current quarter.
- **Y-axis:** Number of matching issues per quarter.
- **Color:** Section type (lead_essay, signposts, lens, book, postcard, worth_your_time, fluxers, other). Each bar is stacked by section using the oklch palette defined as CSS custom properties (`--section-lead-essay`, etc.).
- **Source:** `quarter_distribution` from the search API — a map of `"YYYY-QN"` keys to `{ section: count }` objects. Computed from ALL ranked results, not just the current page.

## Layout

```
┌──────────────────────────────────────────────────┐
│ 95 results                                        │  ← panel header
│                                                    │
│ 14 ┤██ ██ ██ ██ ██ ██ ██    ██ ██ ██ ██ ██ ██ ██ │  ← Y-axis: scaleMax label + tick
│    │██ ██ ██ ██ ██ ██ ██    ██ ██ ██ ██ ██ ██ ██ │     at top, vertical line to baseline
│    │██ ██ ██ ██ ██ ██ ██    ██ ██ ██ ██ ██ ██ ██ │
│    ├──────────────────────────────────────────────│  ← X baseline
│    '21 '22 '23 '24 '25 '26                       │  ← year labels
└──────────────────────────────────────────────────┘
```

### Axes

- **Y-axis line:** Vertical line from top (y=0) to baseline (y=H). Positioned at `AXIS_W - barWidth/2` — the left edge of the first possible bar, not at AXIS_W.
- **Y-axis label:** `scaleMax` value (not `maxCount`) at the top. `scaleMax = Math.max(maxCount, MIN_SCALE)` where `MIN_SCALE=5`. This prevents single-result quarters from filling full height.
- **Y-axis tick:** Short horizontal tick at the top connecting the label to the axis line.
- **X-axis baseline:** Horizontal line from the Y-axis x position to just past the rightmost bar's right edge. The Y-axis line and baseline meet at a clean L-shaped corner.
- **Year labels:** SVG text at the baseline, one per year. All years shown (no thinning). Text-anchor: middle. Format: `'21`, `'22`, etc.

### Geometric invariants (tested in `test/density-geometry.test.ts`)

These spatial relationships are enforced by 21 tests:

1. Y-axis x == left edge of the first bar
2. Baseline starts at Y-axis x
3. Baseline extends past the rightmost bar's right edge
4. Tallest bar top (y=0) aligns with Y-axis top (y=0)
5. All bars sit on the baseline (bar bottom == H)
6. No bar exceeds chart height (height <= H)
7. Bar heights are proportional to count
8. Minimum bar height is 3px
9. Bars are sorted left-to-right by quarter
10. Bars do not overlap
11. Y-axis label == scaleMax (what bars scale to)
12. scaleMax >= MIN_SCALE and >= maxCount
13. Year ticks are all >= 0 (never off the left edge)
14. Year ticks span from first data year to current year
15. Year ticks after the first are evenly spaced
16. Segment heights sum to bar height
17. Segment counts sum to bar totalCount
18. Segments are sorted by count descending

### Bars

- **Width:** Fixed at `(chartWidth / 21) * 0.8` (~21px). Derived from the maximum possible density (21 quarters across the full archive). Width is constant across all queries.
- **Height:** `Math.max(3, (count / scaleMax) * chartHeight)`. Minimum 3px ensures count=1 bars are visible.
- **Position:** Each bar centered on its quarter's x-position. Quarters without data have no bar (gap).
- **Stacking:** Segments stacked bottom-up, sorted by count descending. Each segment colored by section type.
- **Corner radius:** `rx="1"` for subtle rounding.
- **Opacity:** 0.55 (via CSS `.density-bar`).

### Right edge

The chart extends to the current quarter (`today.getFullYear() + Math.floor(today.getMonth() / 3) * 0.25`), not to the last data point. This prevents the chart from ending at a quarter in the past.

### Left edge

Year ticks are clamped to `x >= 0`. If the first data quarter is Q2+ of a year, the year label is placed at x=0 (the chart origin) rather than at a negative offset.

## Sizing

- **Chart width:** 560px (SVG viewBox units). Renders at 100% of the panel width via CSS.
- **Chart height:** 80px.
- **Y-axis margin:** 24px (AXIS_W) reserved for the label.
- **Label height:** 16px below the baseline for year labels.
- **Aspect ratio:** CSS `aspect-ratio: 6 / 1` for responsive scaling.
- **Panel padding:** 0.25rem (minimal — chart uses nearly the full card).

## Interactions

- **Hover:** Native SVG `<title>` tooltips on invisible hit-area rects. Format: `"Q1 2022 — 8 results (Signposts: 5, Worth your time: 2, Essay: 1)"`.
- **Pagination:** The strip persists across pages. It shows the distribution for ALL results, not just the current page. Changing pages does not re-render the strip.

## Visibility

Controlled by the state machine's `densityVisible` flag:

| State | Density strip |
|---|---|
| LANDING | Hidden |
| LANDING_FEATURED | Hidden |
| FEATURED_RESULTS | Hidden |
| RESULTS | **Visible** |
| BROWSING | Carries over from previous state |

## Accessibility

- **ARIA label:** `"Distribution: max N per quarter. 2021-Q2: 5, 2022-Q1: 8, ..."` on the SVG element.
- **Font sizes:** All SVG text at 12px minimum (WCAG AA).
- **Section colors in tooltips:** Tooltip text includes section names, not just colors.
- **Focus:** Not keyboard-focusable (decorative visualization). Screen readers get the aria-label.

## Type boundary

The density strip receives `quarter_distribution` with section keys that are `DisplaySection` values (never `ChunkLabel`). The `toDisplaySection()` boundary in the search pipeline normalizes chunk labels (e.g., `title_summary → lead_essay`) before the distribution is computed.

## Files

- `frontend/js/lib/density.js` — pure computation (bar positions, sizes, year ticks)
- `frontend/js/lib/result-list.js` — SVG rendering (axes, bars, tooltips, labels)
- `frontend/css/styles.css` — panel, bar, axis, and tooltip styles
- `test/density-strip.test.ts` — unit tests for computation
- `test/density-geometry.test.ts` — 21 geometric relationship tests
- `docs/density-strip-research.md` — research on implementations and design patterns
- `specs/density-strip.spec.md` — this specification
