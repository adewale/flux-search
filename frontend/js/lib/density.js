// Density strip — pure computation, no DOM.
// Produces bar data for discrete year-by-year rendering.

export function computeDensityBars(yearDist, width, height) {
  var years = Object.keys(yearDist).map(Number).sort();
  if (years.length === 0) {
    return { bars: [], minYear: 0, maxYear: 0, allYears: [], barWidth: 0, maxCount: 0 };
  }

  var minYear = years[0];
  var maxYear = years[years.length - 1];
  var span = maxYear - minYear || 1;
  var maxCount = Math.max.apply(null, Object.values(yearDist));

  var allYears = [];
  for (var y = minYear; y <= maxYear; y++) allYears.push(y);

  var barWidth = Math.max(3, (width / (span + 1)) * 0.6);

  var bars = [];
  for (var i = 0; i < allYears.length; i++) {
    var y = allYears[i];
    var count = yearDist[y] || 0;
    if (count === 0) continue;
    var x = ((y - minYear) / span) * width;
    var barH = (count / maxCount) * height;
    bars.push({ year: y, x: x, barHeight: barH, count: count });
  }

  return { bars: bars, minYear: minYear, maxYear: maxYear, allYears: allYears, barWidth: barWidth, maxCount: maxCount };
}
