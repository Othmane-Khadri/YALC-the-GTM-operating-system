#!/bin/bash
# GTM-OS — Company Research Scraper
# Scrapes a company's website pages and outputs combined markdown for Claude analysis.
#
# Usage: ./scripts/research.sh <domain> [gtm-os.yaml path]
# Output: Combined markdown to stdout (pipe into Claude for analysis)
#
# Example:
#   ./scripts/research.sh datadog.com
#   ./scripts/research.sh stripe.com ./gtm-os.yaml

set -euo pipefail

DOMAIN="${1:?Usage: research.sh <domain> [gtm-os.yaml path]}"
GTM_OS_PATH="${2:-./gtm-os.yaml}"

# Strip protocol if provided
DOMAIN=$(echo "$DOMAIN" | sed 's|https\?://||' | sed 's|/.*||')

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORTH_RUN="$SCRIPT_DIR/orth-run.sh"

echo "# Research Scrape: $DOMAIN"
echo "# Date: $(date +%Y-%m-%d)"
echo ""

# Scrape main pages — fail silently on 404s
PAGES=("" "/about" "/pricing" "/careers")

for PAGE in "${PAGES[@]}"; do
  URL="https://${DOMAIN}${PAGE}"
  LABEL="${PAGE:-/}"

  echo "## Page: $URL"
  echo ""

  RESULT=$("$ORTH_RUN" olostep /v1/scrape POST "{\"url_to_scrape\": \"$URL\", \"format\": \"markdown\"}" 2>/dev/null) || {
    echo "_Failed to scrape ${URL} (likely 404 or blocked)_"
    echo ""
    continue
  }

  # Extract markdown content from response
  CONTENT=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Try common response shapes
    for key in ['markdown_content', 'content', 'data', 'text', 'result']:
        if key in data:
            val = data[key]
            if isinstance(val, str):
                print(val)
                sys.exit(0)
            elif isinstance(val, dict):
                for k2 in ['markdown_content', 'content', 'text']:
                    if k2 in val:
                        print(val[k2])
                        sys.exit(0)
    # Fallback: dump the whole response
    print(json.dumps(data, indent=2))
except:
    print(sys.stdin.read())
" 2>/dev/null) || CONTENT="$RESULT"

  echo "$CONTENT"
  echo ""
  echo "---"
  echo ""
done

echo "# End of research scrape for $DOMAIN"
