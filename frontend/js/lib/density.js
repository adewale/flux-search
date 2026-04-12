// Density strip — pure computation, no DOM.
// Produces area-fill path points with discrete spikes that drop to
// zero between years, so sparse results don't look like constant density.

export function computeDensityArea(yearDist, width, height) {
  var years = Object.keys(yearDist).map(Number).sort();
  if (years.length === 0) {
    return { points: [], minYear: 0, maxYear: 0, allYears: [], maxCount: 0 };
  }

  var minYear = years[0];
  var maxYear = years[years.length - 1];
  var span = maxYear - minYear || 1;
  var maxCount = Math.max.apply(null, Object.values(yearDist));

  var allYears = [];
  for (var y = minYear; y <= maxYear; y++) allYears.push(y);

  // Each year with data gets a triangular spike; the area drops to
  // baseline on either side so consecutive years still read as separate events.
  var halfStep = 0.35;
  var points = [];

  for (var i = 0; i < allYears.length; i++) {
    var y = allYears[i];
    var count = yearDist[y] || 0;
    var x = ((y - minYear) / span) * width;

    if (count > 0) {
      var peakY = height - (count / maxCount) * height;
      var dx = (halfStep / span) * width;
      points.push({ x: Math.max(0, x - dx), y: height });
      points.push({ x: x, y: peakY });
      points.push({ x: Math.min(width, x + dx), y: height });
    } else {
      points.push({ x: x, y: height });
    }
  }

  return { points: points, minYear: minYear, maxYear: maxYear, allYears: allYears, maxCount: maxCount };
}
