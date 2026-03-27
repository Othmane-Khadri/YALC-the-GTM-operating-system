# Background Agents

GTM-OS background agents run skills on a schedule using macOS launchd.

## Architecture

```
AgentConfig → BackgroundAgent.run() → SkillRegistry → Skill.execute()
                    ↓
              AgentLogger → data/agent-logs/{agentId}/{runId}.json
```

## Creating a Custom Agent

1. Define an `AgentConfig`:

```ts
const config: AgentConfig = {
  id: 'my-agent',
  name: 'My Custom Agent',
  description: 'What it does',
  steps: [
    { skillId: 'scrape-linkedin', input: { url: '...' } },
    { skillId: 'export-data', input: { format: 'csv' }, continueOnError: true },
  ],
  schedule: { type: 'daily', hour: 9, minute: 0 },
  maxRetries: 2,
  timeoutMs: 300000,
}
```

2. Run it manually:
```bash
npx tsx src/cli/index.ts agent:run --agent my-agent --post-url <url>
```

3. Install as a launchd service:
```bash
npx tsx src/cli/index.ts agent:install --agent my-agent --hour 9 --minute 0
```

## Built-in Agents

- `daily-linkedin-scraper` — Scrapes a LinkedIn post daily and exports CSV/JSON.

## Debugging

- Check logs: `data/agent-logs/{agentId}/{runId}.json`
- launchd stdout/stderr: `data/agent-logs/{agentId}/launchd-stdout.log`
- List agents: `npx tsx src/cli/index.ts agent:list`
- Manual run: `npx tsx src/cli/index.ts agent:run --agent <id>`

## Schedule Types

- `daily` — runs at specified hour:minute every day
- `weekly` — runs at specified hour:minute on dayOfWeek (0=Sunday)
- `interval` — runs every N minutes
