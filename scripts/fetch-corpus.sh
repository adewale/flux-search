#!/bin/bash
# Fetch raw HTML from Substack for all issues.
# Run ONCE — subsequent pipeline runs use the cached HTML.
#
# Usage: ./scripts/fetch-corpus.sh

set -euo pipefail

RAW_DIR="data/raw"
SITEMAP="data/cache/sitemap-entries.json"

mkdir -p "$RAW_DIR"

if [ ! -f "$SITEMAP" ]; then
  echo "Fetching sitemap..."
  curl -s "https://read.fluxcollective.org/sitemap.xml" | python3 -c "
import sys, re, json
xml = sys.stdin.read()
entries = []
for m in re.finditer(r'<url>\s*<loc>([^<]+)</loc>(?:\s*<lastmod>([^<]+)</lastmod>)?', xml):
    url, lastmod = m.group(1), m.group(2)
    if '/p/' in url:
        entries.append({'url': url, 'lastmod': lastmod})
with open('$SITEMAP', 'w') as f:
    json.dump(entries, f, indent=2)
print(f'Cached {len(entries)} sitemap entries')
"
fi

TOTAL=$(python3 -c "import json; print(len(json.load(open('$SITEMAP'))))")
echo "Fetching $TOTAL pages..."

FETCHED=0
SKIPPED=0

python3 -c "import json; [print(e['url']) for e in json.load(open('$SITEMAP'))]" | while read -r url; do
  # Extract filename from URL path
  SLUG=$(echo "$url" | sed 's|.*/p/||')
  FILE="$RAW_DIR/$SLUG.html"

  if [ -f "$FILE" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  curl -s "$url" -o "$FILE"
  FETCHED=$((FETCHED + 1))

  # Be polite — 200ms delay between fetches
  sleep 0.2

  if [ $((FETCHED % 20)) -eq 0 ]; then
    echo "  fetched $FETCHED..."
  fi
done

echo "Done. $(ls "$RAW_DIR" | wc -l | tr -d ' ') files in $RAW_DIR"
