#!/bin/bash
# Orthogonal API — Execute an API call
# Usage: ./scripts/orth-run.sh <api_slug> <path> <method> '<json_params>'

set -euo pipefail

API_SLUG="${1:?Usage: orth-run.sh <api_slug> <path> <method> '<json_params>'}"
API_PATH="${2:?Missing path}"
METHOD="${3:?Missing method (GET/POST)}"
PARAMS="${4:-\{\}}"

if [ -z "${ORTHOGONAL_API_KEY:-}" ]; then
  ENV_FILE="$(dirname "$0")/../.env.local"
  if [ -f "$ENV_FILE" ]; then
    export "$(grep '^ORTHOGONAL_API_KEY=' "$ENV_FILE" | head -1)"
  fi
fi

if [ -z "${ORTHOGONAL_API_KEY:-}" ]; then
  echo '{"error": "ORTHOGONAL_API_KEY not set. Add it to .env.local"}' >&2
  exit 1
fi

# Build payload using temp file to avoid shell escaping issues
METHOD_UPPER=$(echo "$METHOD" | tr '[:lower:]' '[:upper:]')
TMPFILE=$(mktemp)

if [[ "$METHOD_UPPER" =~ ^(POST|PUT|PATCH)$ ]]; then
  python3 -c "
import json, sys
params = json.loads(sys.argv[1])
payload = {'api': sys.argv[2], 'path': sys.argv[3], 'body': params}
json.dump(payload, sys.stdout)
" "$PARAMS" "$API_SLUG" "$API_PATH" > "$TMPFILE"
else
  python3 -c "
import json, sys
params = json.loads(sys.argv[1])
payload = {'api': sys.argv[2], 'path': sys.argv[3], 'query': params}
json.dump(payload, sys.stdout)
" "$PARAMS" "$API_SLUG" "$API_PATH" > "$TMPFILE"
fi

curl -s -X POST "https://api.orth.sh/v1/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ORTHOGONAL_API_KEY}" \
  -d @"$TMPFILE"

rm -f "$TMPFILE"
