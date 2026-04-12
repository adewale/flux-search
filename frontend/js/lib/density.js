// Density strip — stacked bars at quarterly granularity.
// Each quarter gets a bar with segments colored by section type.
// Hover tooltips show details; no inline count labels.

var MIN_SCALE = 5;

function quarterToNum(key) {
  var parts = key.split('-Q');
  return parseInt(parts[0]) + (parseInt(parts[1]) - 1) * 0.25;
}

/**
 * Compute bar chart data from a quarter×section distribution.
 * Input: { "2022-Q1": { lead_essay: 3, signposts: 2 }, ... }
 * Output: bars with stacked segments, year ticks, milestone positions.
 */
export function computeDensityBars(quarterSectionDist, width, height, now) {
  var keys = Object.keys(quarterSectionDist).sort();
  if (keys.length === 0) {
    return { bars: [], yearTicks: [], milestones: [], barWidth: 0, maxCount: 0 };
  }

  var today = now || new Date();
  var nowPos = today.getFullYear() + Math.floor(today.getMonth() / 3) * 0.25;

  var positions = keys.map(quarterToNum);
  var minPos = positions[0];
  var maxPos = Math.max(positions[positions.length - 1], nowPos);
  var span = maxPos - minPos || 1;

  // Total count per quarter and global max
  var totals = keys.map(function (k) {
    var sections = quarterSectionDist[k];
    var sum = 0;
    for (var s in sections) sum += sections[s];
    return sum;
  });
  var maxCount = Math.max.apply(null, totals);
  var effectiveMax = Math.max(maxCount, MIN_SCALE);

  var barWidth = Math.max(3, Math.min(20, (width / (span / 0.25 + 2)) * 0.6));

  var bars = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var sections = quarterSectionDist[key];
    var totalCount = totals[i];
    var pos = positions[i];
    var x = ((pos - minPos) / span) * width;
    var barH = (totalCount / effectiveMax) * height;

    // Build stacked segments, sorted by count descending
    var segEntries = [];
    for (var s in sections) segEntries.push({ section: s, count: sections[s] });
    segEntries.sort(function (a, b) { return b.count - a.count; });

    var segments = [];
    var yOffset = 0;
    for (var j = 0; j < segEntries.length; j++) {
      var segH = (segEntries[j].count / totalCount) * barH;
      segments.push({
        section: segEntries[j].section,
        count: segEntries[j].count,
        y: yOffset,
        height: segH,
      });
      yOffset += segH;
    }

    bars.push({ key: key, x: x, height: barH, totalCount: totalCount, segments: segments });
  }

  // Year ticks
  var minYear = Math.floor(minPos);
  var maxYear = today.getFullYear();
  var yearTicks = [];
  for (var y = minYear; y <= maxYear; y++) {
    var tx = ((y - minPos) / span) * width;
    yearTicks.push({ year: y, x: tx });
  }

  return { bars: bars, yearTicks: yearTicks, barWidth: barWidth, maxCount: maxCount };
}
