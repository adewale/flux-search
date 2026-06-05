#!/usr/bin/env bash
set -euo pipefail

INDEX_NAME="${VECTORIZE_INDEX_NAME:-flux-search-chunks}"

ensure_index() {
  local property="$1"
  local type="$2"
  if npx wrangler vectorize list-metadata-index "$INDEX_NAME" 2>/dev/null | grep -q "\b${property}\b"; then
    echo "metadata index exists: ${property}"
    return 0
  fi
  echo "creating metadata index: ${property} (${type})"
  npx wrangler vectorize create-metadata-index "$INDEX_NAME" --propertyName "$property" --type "$type"
}

ensure_index issue_id string
ensure_index published_at string
ensure_index year number
ensure_index section_label string
ensure_index section_label_public string
