// Density strip — pure computation, no DOM.
// Connected area fill with one point per year. Years with results
// are plotted at data height; years without are at baseline.
// A minimum Y-scale prevents single results from filling full height.

var MIN_SCALE = 5;

export function computeDensityArea(yearDist, width, height) {
  var years = Object.keys(yearDist).map(Number).sort();
  if (years.length === 0) {
    return { points: [], minYear: 0, maxYear: 0, allYears: [], maxCount: 0 };
  }

  var minYear = years[0];
  var maxYear = years[years.length - 1];
  var span = maxYear - minYear || 1;
  var maxCount = Math.max.apply(null, Object.values(yearDist));
  var effectiveMax = Math.max(maxCount, MIN_SCALE);

  var allYears = [];
  for (var y = minYear; y <= maxYear; y++) allYears.push(y);

  // One point per year: data height or baseline
  var points = [];
  for (var i = 0; i < allYears.length; i++) {
    var y = allYears[i];
    var count = yearDist[y] || 0;
    var x = ((y - minYear) / span) * width;
    var py = count > 0 ? height - (count / effectiveMax) * height : height;
    points.push({ x: x, y: py });
  }

  return { points: points, minYear: minYear, maxYear: maxYear, allYears: allYears, maxCount: maxCount };
}
