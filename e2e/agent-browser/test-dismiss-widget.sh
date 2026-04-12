#!/bin/bash
# Agent-browser acceptance tests for the dismiss (✕) widget.
# Tests semantic structure of the landing state after a dismiss.
#
# Usage: ./e2e/agent-browser/test-dismiss-widget.sh

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

assert_equals() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

# ========================
# 1. Dismiss is an in-place clear — results persist
# ========================
echo "=== Dismiss widget: clears input, keeps results ==="
agent-browser open "$BASE/?q=trust" 2>/dev/null
sleep 2
RESULTS_BEFORE=$(agent-browser eval 'document.querySelectorAll(".result-card").length' 2>/dev/null)
agent-browser find role button click --name "Clear search" 2>/dev/null
sleep 1
SNAP=$(agent-browser snapshot 2>/dev/null)
INPUT_VALUE=$(agent-browser eval 'document.getElementById("search-input").value' 2>/dev/null)
RESULTS_AFTER=$(agent-browser eval 'document.querySelectorAll(".result-card").length' 2>/dev/null)
URL_Q=$(agent-browser eval 'new URL(location.href).searchParams.get("q") || ""' 2>/dev/null)

assert_equals "search input is empty after ✕" "$INPUT_VALUE" ""
assert_equals "result count unchanged after ✕" "$RESULTS_AFTER" "$RESULTS_BEFORE"
assert_contains "result cards still present" "$SNAP" 'result-card\|result-title'
assert_equals "URL query string preserved (?q=trust)" "$URL_Q" "trust"

# Wait another second to catch any async repopulation.
sleep 1
INPUT_VALUE_LATER=$(agent-browser eval 'document.getElementById("search-input").value' 2>/dev/null)
assert_equals "search input STAYS empty 1s later" "$INPUT_VALUE_LATER" ""

agent-browser screenshot "$SHOTS/dismiss-01-browsing-after-clear.png" 2>/dev/null
echo ""

# ========================
# 2. Hit area is ≥44×44
# ========================
echo "=== Dismiss widget: hit area ==="
agent-browser open "$BASE/?q=trust" 2>/dev/null
sleep 2
WIDTH=$(agent-browser eval 'document.getElementById("search-clear").getBoundingClientRect().width' 2>/dev/null)
HEIGHT=$(agent-browser eval 'document.getElementById("search-clear").getBoundingClientRect().height' 2>/dev/null)

# Compare as floats; bash can't compare floats, so use awk.
if awk "BEGIN { exit !($WIDTH >= 44) }"; then
  echo "  ✓ width ≥ 44px (actual: $WIDTH)"
  PASS=$((PASS + 1))
else
  echo "  ✗ width < 44px (actual: $WIDTH)"
  FAIL=$((FAIL + 1))
fi
if awk "BEGIN { exit !($HEIGHT >= 44) }"; then
  echo "  ✓ height ≥ 44px (actual: $HEIGHT)"
  PASS=$((PASS + 1))
else
  echo "  ✗ height < 44px (actual: $HEIGHT)"
  FAIL=$((FAIL + 1))
fi

OPACITY=$(agent-browser eval 'getComputedStyle(document.getElementById("search-clear")).opacity' 2>/dev/null)
if awk "BEGIN { exit !($OPACITY >= 0.95) }"; then
  echo "  ✓ opacity ≥ 0.95 (actual: $OPACITY)"
  PASS=$((PASS + 1))
else
  echo "  ✗ opacity < 0.95 (actual: $OPACITY)"
  FAIL=$((FAIL + 1))
fi
echo ""

# ========================
# 3. Dismiss is idempotent
# ========================
echo "=== Dismiss widget: idempotent ==="
agent-browser open "$BASE/?q=trust" 2>/dev/null
sleep 2
agent-browser find role button click --name "Clear search" 2>/dev/null
sleep 1
INPUT_VALUE=$(agent-browser eval 'document.getElementById("search-input").value' 2>/dev/null)
assert_equals "input empty after first dismiss" "$INPUT_VALUE" ""
# The button is now hidden; verify.
HIDDEN=$(agent-browser eval 'document.getElementById("search-clear").hidden' 2>/dev/null)
assert_equals "clear button hidden when input is empty" "$HIDDEN" "true"
echo ""

# ========================
# Summary
# ========================
agent-browser close 2>/dev/null
echo "========================"
echo "  $PASS passed, $FAIL failed"
echo "========================"

[ "$FAIL" -eq 0 ]
