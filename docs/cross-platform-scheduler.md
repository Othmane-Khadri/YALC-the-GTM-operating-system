# Cross-Platform Scheduler

## What changed

### `agent:install`

Previously `agent:install` called `scripts/install-agent.sh`, which wrote a macOS launchd `.plist` file and registered it with `launchctl`. This only worked on macOS.

The command now:
- Validates the agent YAML exists in `~/.gtm-os/agents/` before doing anything
- On **macOS**: still writes the launchd plist as before (backward compatible)
- On **all platforms**: prints instructions for starting the universal scheduler

The `--hour` and `--minute` flags are retained but only used for the macOS plist path. On Windows and Linux they are ignored.

### `AgentSchedule` type

A new optional field `expression` has been added to support raw cron passthrough:

```typescript
// Before
interface AgentSchedule {
  type: 'interval' | 'daily' | 'weekly' | 'cron'
  hour?: number
  minute?: number
  dayOfWeek?: number
  intervalMinutes?: number
}

// After — expression added
interface AgentSchedule {
  type: 'interval' | 'daily' | 'weekly' | 'cron'
  hour?: number
  minute?: number
  dayOfWeek?: number
  intervalMinutes?: number
  expression?: string   // required when type is 'cron'
}
```

Existing agent YAMLs using `daily`, `weekly`, or `interval` are unaffected.

---

## What was added

### `scheduler:start`

A long-lived Node.js process that reads every YAML under `~/.gtm-os/agents/`, registers each one with [node-cron](https://github.com/node-cron/node-cron), and runs the corresponding `BackgroundAgent` when the schedule fires. No OS-level calls — works on macOS, Windows, and Linux.

```
yalc-gtm scheduler:start
```

Shuts down cleanly on `Ctrl+C` (SIGINT) or SIGTERM.

### `scheduler:status`

Prints all agent YAMLs found in `~/.gtm-os/agents/` with their resolved cron expression and next scheduled fire time.

```
yalc-gtm scheduler:status
```

### `src/lib/agents/cross-platform-scheduler.ts`

New module. Exports:
- `CrossPlatformScheduler` — class that wraps node-cron lifecycle
- `agentScheduleToCron(schedule)` — pure function, converts an `AgentSchedule` to a 5-field cron string; used independently by `scheduler:status`

---

## Usage

### Basic — run in the foreground

Install a framework (this writes the agent YAML):

```bash
yalc-gtm framework:install competitor-audience-mining
```

Start the scheduler:

```bash
yalc-gtm scheduler:start

── YALC Scheduler ──────────────────────────────────

  registered: competitor-audience-mining       0 8 * * *

Scheduler running (1 agent(s)). Press Ctrl+C to stop.
```

Check what is registered and when each agent will next fire:

```bash
yalc-gtm scheduler:status

── YALC Scheduler Status ───────────────────────────

  competitor-audience-mining         0 8 * * *        next: 5/19/2026, 8:00:00 AM
```

### Keep alive across reboots (any OS)

Install [pm2](https://pm2.keymetrics.io/) once:

```bash
npm install -g pm2
```

Start and persist the scheduler:

```bash
pm2 start "yalc-gtm scheduler:start" --name yalc-scheduler
pm2 save
pm2 startup    # follow the printed command — registers with the OS init system
```

Same commands work on macOS, Windows, and Linux.

### Raw cron expression in agent YAML

When `daily`, `weekly`, and `interval` are not expressive enough, use `type: cron` with an explicit expression:

```yaml
id: weekday-prospector
name: Weekday Prospector
description: Runs the prospecting pipeline Monday through Friday at 9am
steps:
  - skillId: prospect-discovery-pipeline
    input:
      tenant: default
    continueOnError: true
schedule:
  type: cron
  expression: "0 9 * * 1-5"
maxRetries: 2
timeoutMs: 600000
```

---

## Migration guide for existing users

| You used to do | Do this instead |
|---|---|
| `yalc-gtm agent:install --agent <id>` on macOS | Same command still works — plist is still written |
| Relied on launchd to fire agents on Windows | Run `yalc-gtm scheduler:start` (or keep it alive with pm2) |
| No Windows scheduling option existed | `yalc-gtm scheduler:start` now works on Windows |
| Checked launchd logs in `~/Library/Logs` | Logs are in `data/agent-logs/<id>/launchd-stdout.log` (macOS plist path) or printed to the scheduler process stdout |

### If you are on macOS and want to switch from launchd to the scheduler

1. Unload the existing plist:
   ```bash
   launchctl bootout "gui/$(id -u)/com.gtm-os.agent.<id>"
   ```
2. Delete the plist:
   ```bash
   rm ~/Library/LaunchAgents/com.gtm-os.agent.<id>.plist
   ```
3. Start the scheduler instead:
   ```bash
   yalc-gtm scheduler:start
   ```

The agent YAML in `~/.gtm-os/agents/` is shared by both paths — no changes needed there.
