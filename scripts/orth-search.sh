#!/bin/bash
# Orthogonal API — Semantic search for the best API match
# Usage: ./scripts/orth-search.sh "find SaaS companies in France" [limit]

set -euo pipefail

PROMPT="${1:?Usage: orth-search.sh <prompt> [limit]}"
LIMIT="${2:-5}"

if [ -z "${ORTHOGONAL_API_KEY:-}" ]; then
  # Try loading from .env.local in project root
  ENV_FILE="$(dirname "$0")/../.env.local"
  if [ -f "$ENV_FILE" ]; then
    export "$(grep '^ORTHOGONAL_API_KEY=' "$ENV_FILE" | head -1)"
  fi
fi

if [ -z "${ORTHOGONAL_API_KEY:-}" ]; then
  echo '{"error": "ORTHOGONAL_API_KEY not set. Add it to .env.local"}' >&2
  exit 1
fi

curl -s -X POST "https://api.orth.sh/v1/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ORTHOGONAL_API_KEY}" \
  -d "{\"prompt\": $(printf '%s' "$PROMPT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'), \"limit\": ${LIMIT}}"
