// Density strip — directly-labeled bars at quarterly granularity.
// Each quarter with results gets a bar with its count printed above.
// A minimum Y-scale prevents single results from filling full height.

var MIN_SCALE = 5;

/**
 * Parse a quarter key ("2022-Q1") into a numeric position.
 * Q1=0, Q2=0.25, Q3=0.5, Q4=0.75 within the year.
 */
function quarterToNum(key) {
  var parts = key.split('-Q');
  var year = parseInt(parts[0]);
  var q = parseInt(parts[1]);
  return year + (q - 1) * 0.25;
}

export function computeDensityBars(quarterDist, width, height) {
  var keys = Object.keys(quarterDist).sort();
  if (keys.length === 0) {
    return { bars: [], yearTicks: [], barWidth: 0, maxCount: 0 };
  }

  var positions = keys.map(quarterToNum);
  var minPos = positions[0];
  var maxPos = positions[positions.length - 1];
  var span = maxPos - minPos || 1;

  var maxCount = Math.max.apply(null, Object.values(quarterDist));
  var effectiveMax = Math.max(maxCount, MIN_SCALE);

  var barWidth = Math.max(3, Math.min(20, (width / (span / 0.25 + 2)) * 0.6));

  var bars = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var count = quarterDist[key];
    var pos = positions[i];
    var x = ((pos - minPos) / span) * width;
    var barH = (count / effectiveMax) * height;
    bars.push({ key: key, x: x, height: barH, count: count });
  }

  // Year ticks: one per year in the range
  var minYear = Math.floor(minPos);
  var maxYear = Math.ceil(maxPos);
  var yearTicks = [];
  for (var y = minYear; y <= maxYear; y++) {
    var tx = ((y - minPos) / span) * width;
    yearTicks.push({ year: y, x: tx });
  }

  return { bars: bars, yearTicks: yearTicks, barWidth: barWidth, maxCount: maxCount };
}
