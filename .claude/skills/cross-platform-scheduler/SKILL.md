# cross-platform-scheduler

Manage the YALC cross-platform background agent scheduler — start it, check status, or show setup instructions for keeping it alive across reboots.

## Triggers

Use this skill when the user says:
- "start my scheduled agents"
- "is my scheduler running"
- "how do I run agents on Windows"
- "set up scheduled agents"
- "agent cron", "cron for agents", "schedule agents"
- "keep agents running in the background"
- "scheduler status"

## What this skill does

YALC background agents are defined as YAML files in `~/.gtm-os/agents/`. The cross-platform scheduler reads those YAMLs and runs each agent on its declared schedule using `node-cron` — no OS-level plumbing, works on macOS, Windows, and Linux.

## Procedure

### Step 1 — Check for agent YAMLs

Run:
```
npx tsx src/cli/index.ts scheduler:status
```

If output is "No agents found", the user needs to install a framework first (`framework:install <name>`) or create a custom agent (`agent:create`). Stop here and guide them.

### Step 2 — Start the scheduler

```
npx tsx src/cli/index.ts scheduler:start
```

This is a long-lived process. It prints each registered agent and its cron expression, then runs indefinitely.

### Step 3 — Keep it alive across reboots (optional)

Ask the user if they want the scheduler to survive reboots. If yes:

**Any platform (requires pm2):**
```bash
npm install -g pm2
pm2 start "npx tsx /path/to/yalc-internal/src/cli/index.ts scheduler:start" --name yalc-scheduler
pm2 save
pm2 startup   # follow the printed command to register with the OS
```

**macOS only (launchd, no pm2 needed):**
The existing `agent:install --agent <id>` command still writes a launchd plist for macOS users who prefer native scheduling.

## Schedule format reference

Agent YAMLs support these schedule shapes:

```yaml
# Daily at 08:00
schedule:
  type: daily
  hour: 8
  minute: 0

# Weekly Monday at 09:00
schedule:
  type: weekly
  hour: 9
  minute: 0
  dayOfWeek: 1

# Every 30 minutes
schedule:
  type: interval
  intervalMinutes: 30

# Raw cron passthrough
schedule:
  type: cron
  expression: "0 9 * * 1-5"  # weekdays at 09:00
```

## Key files

| File | Purpose |
|------|---------|
| `src/lib/agents/cross-platform-scheduler.ts` | Core scheduler — reads YAMLs, registers node-cron jobs |
| `src/lib/agents/yaml-loader.ts` | Loads `~/.gtm-os/agents/*.yaml` |
| `src/lib/agents/types.ts` | `AgentSchedule` type (includes `expression?` for cron passthrough) |
| `src/cli/index.ts` | `scheduler:start` and `scheduler:status` CLI commands |
