#!/bin/bash
# Install a GTM-OS background agent as a launchd service.
# Usage: ./scripts/install-agent.sh <agent-id> [hour] [minute]

set -euo pipefail

AGENT_ID="${1:?Usage: install-agent.sh <agent-id> [hour] [minute]}"
HOUR="${2:-8}"
MINUTE="${3:-0}"

GTM_OS_PATH="$(cd "$(dirname "$0")/.." && pwd)"
NODE_PATH="$(which node)"
PLIST_NAME="com.gtm-os.agent.${AGENT_ID}.plist"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${PLIST_NAME}"
TEMPLATE="${GTM_OS_PATH}/templates/agent.plist.template"

if [ ! -f "$TEMPLATE" ]; then
  echo "Error: Template not found at $TEMPLATE"
  exit 1
fi

# Ensure log directory exists
mkdir -p "${GTM_OS_PATH}/data/agent-logs/${AGENT_ID}"

# Generate plist from template
sed \
  -e "s|{{AGENT_ID}}|${AGENT_ID}|g" \
  -e "s|{{NODE_PATH}}|${NODE_PATH}|g" \
  -e "s|{{GTM_OS_PATH}}|${GTM_OS_PATH}|g" \
  -e "s|{{HOUR}}|${HOUR}|g" \
  -e "s|{{MINUTE}}|${MINUTE}|g" \
  "$TEMPLATE" > "$PLIST_PATH"

echo "Created plist: $PLIST_PATH"

# Unload if already loaded
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

# Load the new plist
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "Agent '${AGENT_ID}' installed and loaded."
echo "  Schedule: daily at ${HOUR}:${MINUTE}"
echo "  Logs: ${GTM_OS_PATH}/data/agent-logs/${AGENT_ID}/"
