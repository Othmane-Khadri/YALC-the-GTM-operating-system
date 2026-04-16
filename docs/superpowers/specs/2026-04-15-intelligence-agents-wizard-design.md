# Design: Intelligence Feedback Loop, Agent Scaffolder, Setup Wizard

**Date:** 2026-04-15
**Author:** Othmane Khadri + Claude
**Status:** Approved

---

## 1. Intelligence Feedback Loop

### Problem
The intelligence store accumulates insights from campaign outcomes, A/B tests, and user feedback. The optimizer and qualifier already read from it, but campaign *creation* (variant copy generation) and the *orchestrate* skill do not. This means the "learns from every interaction" claim is only half-wired.

### Integration Point A: Campaign Creator

**File:** `src/lib/campaign/creator.ts`
**Where:** After campaign hypothesis is defined, before Claude generates variant copy.

```typescript
const intel = await intelligenceStore.getForPrompt(campaign.segment ?? undefined)
const intelContext = intel.length > 0
  ? `\n\nIntelligence from past campaigns (use to inform copy, not copy verbatim):\n${intel.map(i => `- [${i.category}/${i.confidence}] ${i.insight}`).join('\n')}`
  : ''
```

Append `intelContext` to the Claude prompt that generates messaging variants. Intelligence is labeled with category and confidence level so Claude can weight proven insights higher.

### Integration Point B: Orchestrate Skill

**File:** `src/lib/skills/builtin/orchestrate.ts`
**Where:** When building the planning prompt for Claude.

```typescript
const channelIntel = await intelligenceStore.query({ category: 'channel', minConfidence: 'validated' })
const timingIntel = await intelligenceStore.query({ category: 'timing', minConfidence: 'validated' })
const intelBlock = [...channelIntel, ...timingIntel]
  .map(i => `- [${i.confidence}] ${i.insight}`)
  .join('\n')
```

Injected into the orchestrator's planning prompt so workflow decisions (which channel, what timing) are informed by historical performance data.

### What's NOT changing
- `getForPrompt()` and `query()` APIs — no changes
- Intelligence write path — no changes
- Optimizer and qualifier reads — already working, untouched

---

## 2. Agent Scaffolder (`agent:create`)

### Problem
Users must hand-write AgentConfig in TypeScript or YAML. Only one example exists. No interactive creation flow.

### CLI Command

```
yalc-gtm agent:create
```

### Interactive Flow
1. **Agent ID** — kebab-case, validated unique against `~/.gtm-os/agents/`
2. **Description** — free text
3. **Skills** — multi-select from registered skills (fetched from SkillRegistry)
4. **Per-skill inputs** — for each selected skill, prompt for required inputs. Use skill metadata to determine which inputs are needed.
5. **Schedule** — type (daily/weekly/interval/cron), then timing fields
6. **Retry/timeout** — defaults to 2 retries, 5 min timeout. Prompt to override.
7. **Write YAML** — saves to `~/.gtm-os/agents/{id}.yaml`
8. **Offer install** — prompt to run `agent:install` immediately

### YAML Output Format
```yaml
id: weekly-lead-qualifier
name: Weekly Lead Qualifier
description: Scrapes LinkedIn post engagers and qualifies against ICP every Monday
steps:
  - skillId: scrape-linkedin
    input:
      url: https://linkedin.com/posts/...
      type: both
      maxPages: 10
  - skillId: qualify-leads
    input:
      source: result-set
    continueOnError: true
schedule:
  type: weekly
  dayOfWeek: 1
  hour: 8
  minute: 0
maxRetries: 2
timeoutMs: 300000
```

### New Files
- `src/cli/commands/agent-create.ts` — interactive wizard using `@inquirer/prompts`
- `src/lib/agents/yaml-loader.ts` — parses YAML into `AgentConfig`, validates against schema

### Changes to Existing Files
- `src/cli/index.ts` — add `agent:create` command
- `src/lib/agents/runner.ts` — `agent:run` resolves YAML from `~/.gtm-os/agents/` if no TypeScript factory matches the agent ID

---

## 3. Setup Wizard

### Problem
New users must manually edit `.env.local` with 8-10 keys. No guidance, no validation, no auto-generation of crypto keys.

### CLI Command

```
yalc-gtm setup --wizard
```

### Flow
1. **Check existing** — read `.env.local` if it exists, identify which keys are already set
2. **Required keys** — prompt one at a time with signup URLs:
   - `ANTHROPIC_API_KEY` (https://console.anthropic.com/settings/keys)
   - `UNIPILE_API_KEY` + `UNIPILE_DSN`
   - `FIRECRAWL_API_KEY` (https://firecrawl.dev)
   - `CRUSTDATA_API_KEY` (https://crustdata.com)
   - `NOTION_API_KEY` (https://www.notion.so/my-integrations)
3. **Live validation** — each key validated immediately after entry (5s timeout API call)
4. **Auto-generate** — `ENCRYPTION_KEY` and optionally `GTM_OS_API_TOKEN` via `crypto.randomBytes(32).toString('hex')`
5. **Optional keys** — mention FULLENRICH, INSTANTLY, ORTHOGONAL as optional with URLs, skip if user presses Enter
6. **Write** — create/update `.env.local` preserving existing keys
7. **Provider validation** — run existing provider validation logic
8. **Doctor** — run full diagnostics automatically
9. **Next steps** — print `onboard` command suggestion

### Implementation
- New function `runSetupWizard()` in `src/lib/config/setup.ts`
- Uses `@inquirer/prompts` with `password` type (masks key input)
- Key groups: required (must provide), auto-generated (handled automatically), optional (can skip)
- Validates each key by instantiating the service and making a lightweight API call

### Changes to Existing Files
- `src/cli/index.ts` — add `--wizard` option to `setup` command
- `src/lib/config/setup.ts` — new `runSetupWizard()` function

---

## Files Summary

| Action | File |
|--------|------|
| **Edit** | `src/lib/campaign/creator.ts` — inject intelligence into variant prompt |
| **Edit** | `src/lib/skills/builtin/orchestrate.ts` — inject intelligence into planning prompt |
| **Create** | `src/cli/commands/agent-create.ts` — interactive agent wizard |
| **Create** | `src/lib/agents/yaml-loader.ts` — YAML → AgentConfig parser |
| **Edit** | `src/cli/index.ts` — add `agent:create` command + `--wizard` on setup |
| **Edit** | `src/lib/agents/runner.ts` — resolve YAML configs |
| **Edit** | `src/lib/config/setup.ts` — add `runSetupWizard()` |

## Testing

- **Intelligence:** Create a campaign with existing intelligence in store → verify Claude prompt includes insights. Create without intelligence → verify no crash.
- **Agent scaffolder:** Run `agent:create`, fill prompts → verify YAML is valid. Run `agent:run --agent <id>` with the generated YAML → verify execution.
- **Setup wizard:** Run `setup --wizard` with empty `.env.local` → verify prompts appear. Run with partial `.env.local` → verify only missing keys prompted. Verify `.env.local` output is valid dotenv format.
