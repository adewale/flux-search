#!/bin/bash
# User journey tests using agent-browser
# Tests semantic structure via accessibility tree, not pixel screenshots
#
# Usage: ./e2e/agent-browser/test-journeys.sh

set -euo pipefail

PASS=0
FAIL=0
BASE="https://flux-search.adewale-883.workers.dev"
SHOTS="e2e/agent-browser/screenshots"
mkdir -p "$SHOTS"

assert_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi "$needle"; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — expected to find: $needle"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local label="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -qi "$needle"; then
    echo "  ✗ $label — should NOT contain: $needle"
    FAIL=$((FAIL + 1))
  else
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  fi
}

# ========================
# 1. Landing page
# ========================
echo "=== Landing page ==="
agent-browser open "$BASE" 2>/dev/null
sleep 1
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "has h1 FLUX Review Search" "$SNAP" 'heading "FLUX Review Search"'
assert_contains "has search box" "$SNAP" 'searchbox'
assert_contains "has landing quote (blockquote)" "$SNAP" 'blockquote'
assert_contains "has example query buttons" "$SNAP" 'button.*institutional trust'
assert_contains "has search tips disclosure" "$SNAP" 'DisclosureTriangle.*Search tips'
assert_contains "has footer with FLUX Review link" "$SNAP" 'link "The FLUX Review"'
assert_contains "has Cloudflare attribution" "$SNAP" 'Built on the Cloudflare Developer Platform'
assert_not_contains "no results on landing page" "$SNAP" 'result-card'

agent-browser screenshot "$SHOTS/01-landing.png" 2>/dev/null
echo ""

# ========================
# 2. Search for "trust"
# ========================
echo "=== Search: trust ==="
agent-browser fill "@e9" "trust" 2>/dev/null
agent-browser find role button click --name "Search" 2>/dev/null
sleep 2
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "has result links" "$SNAP" 'link.*trust'
assert_not_contains "landing quote hidden during search" "$SNAP" 'blockquote.*When you choose'

agent-browser screenshot "$SHOTS/02-search-trust.png" 2>/dev/null
echo ""

# ========================
# 3. Click first result → issue page
# ========================
echo "=== Issue page ==="
agent-browser find first ".result-card a" click 2>/dev/null
sleep 2
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "has issue title heading" "$SNAP" 'heading.*level=1'
assert_contains "has section tab buttons" "$SNAP" 'button.*Signpost\|tab\|Essay'
assert_contains "has Read on Substack link" "$SNAP" 'link "Read on Substack"'
assert_contains "has prev or next navigation" "$SNAP" 'link.*Prev\|link.*Next'

agent-browser screenshot "$SHOTS/03-issue-page.png" 2>/dev/null
echo ""

# ========================
# 4. Empty search
# ========================
echo "=== Empty search ==="
agent-browser open "$BASE" 2>/dev/null
agent-browser fill "input" "qxzjvkwm" 2>/dev/null
agent-browser find role button click --name "Search" 2>/dev/null
sleep 2
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "shows no results message" "$SNAP" 'No results found'
assert_not_contains "no quote in empty state" "$SNAP" 'blockquote'

agent-browser screenshot "$SHOTS/04-empty.png" 2>/dev/null
echo ""

# ========================
# 5. Autocomplete
# ========================
echo "=== Autocomplete ==="
agent-browser open "$BASE" 2>/dev/null
agent-browser fill "input" "tru" 2>/dev/null
sleep 1
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "autocomplete dropdown visible" "$SNAP" 'listbox\|option\|StaticText.*trust'

agent-browser screenshot "$SHOTS/05-autocomplete.png" 2>/dev/null
echo ""

# ========================
# 6. Filter-only query
# ========================
echo "=== Filter: before:2024 ==="
agent-browser open "$BASE/?q=before%3A2024" 2>/dev/null
sleep 2
SNAP=$(agent-browser snapshot 2>/dev/null)

assert_contains "has results for filter-only query" "$SNAP" 'link'
assert_not_contains "no pre-2021 dates in results" "$SNAP" '2012\|2019\|2020'

agent-browser screenshot "$SHOTS/06-filter-before-2024.png" 2>/dev/null
echo ""

# ========================
# Summary
# ========================
agent-browser close 2>/dev/null
echo "========================"
echo "  $PASS passed, $FAIL failed"
echo "========================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
