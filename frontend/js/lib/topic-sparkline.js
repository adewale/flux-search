/**
 * Topic timeline → sparkline geometry.
 *
 * Bobbin equivalent: rank-over-time rail panel on /topics/:slug.
 * Pure function so it unit-tests without a DOM.
 *
 * Input is an array of { year, month, occurrences }. Output is an array
 * of plotted points and an SVG path string. Time spacing is uniform —
 * each row gets equal width — which is what we want for a "coarse rhythm"
 * indicator rather than a calendar-accurate plot.
 */
export function computeSparkline(timeline, width, height) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { points: [], path: '', maxOccurrences: 0 };
  }

  var sorted = timeline.slice().sort(function (a, b) {
    return a.year !== b.year ? a.year - b.year : a.month - b.month;
  });

  var maxOccurrences = sorted.reduce(function (m, r) {
    return Math.max(m, r.occurrences || 0);
  }, 0);

  var points;
  if (sorted.length === 1) {
    var only = sorted[0];
    points = [{
      x: width / 2,
      y: maxOccurrences > 0 ? 0 : height,
      year: only.year,
      month: only.month,
      occurrences: only.occurrences,
    }];
  } else {
    var stepX = width / (sorted.length - 1);
    points = sorted.map(function (row, i) {
      var ratio = maxOccurrences > 0 ? (row.occurrences / maxOccurrences) : 0;
      // Clamp the last point to width — float rounding from i*stepX can
      // overshoot by 1ULP (e.g. 50.00000000000001 for w=50, n=12).
      var rawX = i === sorted.length - 1 ? width : i * stepX;
      return {
        x: Math.min(width, Math.max(0, rawX)),
        y: height - ratio * height,
        year: row.year,
        month: row.month,
        occurrences: row.occurrences,
      };
    });
  }

  var path = points.map(function (p, i) {
    return (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + p.y.toFixed(2);
  }).join(' ');

  return { points: points, path: path, maxOccurrences: maxOccurrences };
}

/**
 * SVG markup for a topic sparkline. Inline so the topics page doesn't
 * need a separate stylesheet rule.
 */
export function topicSparklineSvg(timeline, opts) {
  var width = (opts && opts.width) || 240;
  var height = (opts && opts.height) || 40;
  var spark = computeSparkline(timeline, width, height);
  if (spark.points.length === 0) return '';

  var dotRadius = 2;
  var dots = spark.points.map(function (p) {
    return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) +
      '" r="' + dotRadius + '" class="sparkline-dot"><title>' +
      p.year + '-' + String(p.month).padStart(2, '0') + ': ' +
      p.occurrences + '</title></circle>';
  }).join('');

  return '<svg class="topic-sparkline" viewBox="-2 -2 ' + (width + 4) + ' ' +
    (height + 4) + '" aria-label="Mentions over time">' +
    '<path d="' + spark.path + '" fill="none" class="sparkline-path"/>' +
    dots +
    '</svg>';
}
