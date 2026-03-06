#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GTM-OS Day 4 — Sequential Sub-Brief Executor
# ─────────────────────────────────────────────────────────────────────────────
#
# Loops through all 12 sub-briefs in dependency order.
# Each sub-brief is fed to Claude Code as a self-contained task.
# The developer runs this once and walks away.
#
# Usage:
#   cd ~/Desktop/gtm-os
#   chmod +x tasks/run-day-04.sh
#   ./tasks/run-day-04.sh              # Run all 12
#   ./tasks/run-day-04.sh --from 5     # Resume from sub-brief 5
#   ./tasks/run-day-04.sh --only 3     # Run only sub-brief 3
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASKS_DIR="$PROJECT_DIR/tasks"
LOG_DIR="$PROJECT_DIR/tasks/logs"

mkdir -p "$LOG_DIR"

# Sub-briefs in dependency order
BRIEFS=(
  "day-04-sub-01-provider-registry"
  "day-04-sub-02-mcp-client"
  "day-04-sub-03-mcp-server"
  "day-04-sub-04-skills-engine"
  "day-04-sub-05-intelligence-system"
  "day-04-sub-06-human-review"
  "day-04-sub-07-web-intelligence"
  "day-04-sub-08-campaign-manager"
  "day-04-sub-09-learning-loop"
  "day-04-sub-10-provider-intelligence"
  "day-04-sub-11-nudge-engine"
  "day-04-sub-12-data-quality"
)

# ── Parse args ───────────────────────────────────────────────────────────────
START_FROM=1
ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      START_FROM="$2"
      shift 2
      ;;
    --only)
      ONLY="$2"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1"
      echo "Usage: $0 [--from N] [--only N]"
      exit 1
      ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────

print_header() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  SUB-BRIEF $1 of ${#BRIEFS[@]}: $2"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

run_brief() {
  local index=$1
  local brief_name="${BRIEFS[$((index - 1))]}"
  local brief_file="$TASKS_DIR/${brief_name}.md"
  local log_file="$LOG_DIR/${brief_name}.log"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  if [[ ! -f "$brief_file" ]]; then
    echo "ERROR: Brief file not found: $brief_file"
    exit 1
  fi

  print_header "$index" "$brief_name"

  echo "[$timestamp] Starting sub-brief $index: $brief_name" | tee -a "$LOG_DIR/run.log"

  # Feed the brief to Claude Code
  # - Read the brief content
  # - Pipe it as a prompt with clear instructions
  # - --max-turns 40 gives it enough room to complete
  # - Capture output to log file AND terminal
  cat "$brief_file" | claude -p \
    --max-turns 40 \
    --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
    2>&1 | tee "$log_file"

  local exit_code=${PIPESTATUS[1]}

  if [[ $exit_code -ne 0 ]]; then
    echo ""
    echo "ERROR: Sub-brief $index ($brief_name) failed with exit code $exit_code"
    echo "Log: $log_file"
    echo "[$timestamp] FAILED sub-brief $index: $brief_name (exit $exit_code)" >> "$LOG_DIR/run.log"
    exit 1
  fi

  # Build check after each sub-brief
  echo ""
  echo "→ Running build check..."
  cd "$PROJECT_DIR"
  if ! pnpm build 2>&1 | tail -5; then
    echo ""
    echo "BUILD FAILED after sub-brief $index ($brief_name)"
    echo "Attempting auto-fix..."

    # Give Claude one chance to fix build errors
    pnpm build 2>&1 | claude -p \
      --max-turns 10 \
      --allowedTools "Read,Write,Edit,Glob,Grep,Bash" \
      "The build failed after implementing sub-brief $brief_name. Here are the errors. Fix them. Do not change any functionality — only fix TypeScript/build errors." \
      2>&1 | tee -a "$log_file"

    # Retry build
    if ! pnpm build 2>&1 | tail -5; then
      echo "BUILD STILL FAILING — stopping. Fix manually, then re-run with: $0 --from $index"
      echo "[$timestamp] BUILD FAILED sub-brief $index: $brief_name" >> "$LOG_DIR/run.log"
      exit 1
    fi
  fi

  echo "→ Build passed."
  echo ""

  # Commit after each successful sub-brief
  cd "$PROJECT_DIR"
  git add -A
  git commit -m "$(cat <<EOF
feat: ${brief_name/day-04-sub-??-/} (4.${index})

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
  )" || true

  echo "[$timestamp] COMPLETED sub-brief $index: $brief_name" >> "$LOG_DIR/run.log"
  echo ""
}

# ── Main loop ────────────────────────────────────────────────────────────────

cd "$PROJECT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  GTM-OS Day 4 — Architecture Implementation                       ║"
echo "║  12 sub-briefs, sequential execution                               ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_DIR"
echo "Start:   $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

if [[ -n "$ONLY" ]]; then
  echo "Mode: Running ONLY sub-brief $ONLY"
  run_brief "$ONLY"
else
  echo "Mode: Running sub-briefs $START_FROM through ${#BRIEFS[@]}"
  echo ""

  for i in $(seq "$START_FROM" "${#BRIEFS[@]}"); do
    run_brief "$i"
  done
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  ALL DONE                                                          ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Logs:     $LOG_DIR/"
echo ""
echo "Next steps:"
echo "  1. pnpm dev → test everything end to end"
echo "  2. Review git log for the 12 commits"
echo "  3. Push when satisfied"
echo ""
