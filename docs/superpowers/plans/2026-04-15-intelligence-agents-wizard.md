# Intelligence Feedback + Agent Scaffolder + Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire intelligence feedback into campaign creation and orchestration, add interactive `agent:create` CLI command with YAML output, and add `setup --wizard` for guided first-run configuration.

**Architecture:** Three independent features sharing no code paths. Intelligence feedback adds callers to existing `IntelligenceStore.getForPrompt()` and `.query()`. Agent scaffolder creates a YAML-based config layer on top of the existing `AgentConfig` TypeScript interface. Setup wizard extends the existing `runSetup()` with an interactive `runSetupWizard()` function.

**Tech Stack:** TypeScript, @inquirer/prompts, js-yaml, Node crypto, Drizzle ORM (read-only for intelligence)

---

## Task 1: Intelligence Feedback in Copy Generator

**Files:**
- Modify: `src/lib/outbound/copy-generator.ts:23-72`
- Modify: `src/lib/campaign/creator.ts:111-125`

- [ ] **Step 1: Add intelligence import to copy-generator.ts**

At the top of `src/lib/outbound/copy-generator.ts`, add the import:

```typescript
import { IntelligenceStore } from '../intelligence/store'
```

- [ ] **Step 2: Inject intelligence context into the system prompt**

In `src/lib/outbound/copy-generator.ts`, replace the `generateCampaignCopy` function body. After the `rulesBlock` construction (line 31) and before the `systemPrompt` template literal (line 33), add intelligence retrieval:

```typescript
export async function generateCampaignCopy(input: CopyGeneratorInput): Promise<GeneratedVariant[]> {
  const { segmentId, hypothesis, variantCount, leadContext } = input

  // Load voice context
  const voiceContext = await getVoiceContext(segmentId)
  const voiceBlock = voiceContext ? formatVoicePrompt(voiceContext) : ''

  // Build rules block
  const rulesBlock = OUTBOUND_RULES.map((r) => `- ${r.name} (${r.id})`).join('\n')

  // Load intelligence from past campaigns
  const intelligenceStore = new IntelligenceStore()
  const intel = await intelligenceStore.getForPrompt(segmentId)
  const intelBlock = intel.length > 0
    ? `\n## Intelligence from Past Campaigns\nUse these proven insights to inform copy — do not copy verbatim:\n${intel.map(i => `- [${i.category}/${i.confidence}] ${i.insight}`).join('\n')}\n`
    : ''

  const systemPrompt = `You are a LinkedIn outreach copywriter. Generate ${variantCount} distinct campaign messaging variants.

${voiceBlock}
${intelBlock}
## Outbound Rules (ALL messages MUST follow these)
${rulesBlock}
```

The rest of the function stays the same. The `intelBlock` is inserted between `voiceBlock` and the rules section.

- [ ] **Step 3: Pass tenantId through to copy generator**

In `src/lib/campaign/creator.ts`, update the `generateCampaignCopy` call (line 116) to pass tenantId:

```typescript
      variantDefs = await generateCampaignCopy({
        segmentId: opts.segmentId,
        hypothesis,
        variantCount: 2,
        tenantId,
      })
```

In `src/lib/outbound/copy-generator.ts`, add `tenantId` to the input interface and use it:

```typescript
interface CopyGeneratorInput {
  segmentId?: string
  hypothesis: string
  variantCount: number
  leadContext?: string
  tenantId?: string
}
```

And update the store instantiation:

```typescript
  const intelligenceStore = new IntelligenceStore(input.tenantId)
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbound/copy-generator.ts src/lib/campaign/creator.ts
git commit -m "feat: inject intelligence feedback into campaign copy generation"
```

---

## Task 2: Intelligence Feedback in Orchestrate Planner

**Files:**
- Modify: `src/lib/orchestrator/planner.ts:1-84`

- [ ] **Step 1: Add intelligence import**

At the top of `src/lib/orchestrator/planner.ts`:

```typescript
import { IntelligenceStore } from '../intelligence/store'
```

- [ ] **Step 2: Inject intelligence into planner system prompt**

In the `decompose` function, after `const skillList = registry.getForPlanner()` (line 10) and before the `anthropic.messages.create` call (line 48), add:

```typescript
  // Load channel and timing intelligence for workflow planning
  const intelligenceStore = new IntelligenceStore()
  const channelIntel = await intelligenceStore.query({ category: 'channel', minConfidence: 'validated' })
  const timingIntel = await intelligenceStore.query({ category: 'timing', minConfidence: 'validated' })
  const icpIntel = await intelligenceStore.query({ category: 'icp', minConfidence: 'validated' })
  const allIntel = [...channelIntel, ...timingIntel, ...icpIntel]
  const intelBlock = allIntel.length > 0
    ? `\nIntelligence from past campaigns (use to inform channel/timing/targeting decisions):\n${allIntel.map(i => `- [${i.category}/${i.confidence}] ${i.insight}`).join('\n')}\n`
    : ''
```

Then insert `${intelBlock}` into the system prompt, after the rules section and before the output format:

```typescript
  const systemPrompt = `You are a GTM workflow planner. Decompose the user's request into phased skill execution.

Available skills:
${skillList}
${intelBlock}
Rules:
- Each phase can have 1+ steps that run in order
...`
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/orchestrator/planner.ts
git commit -m "feat: inject intelligence feedback into orchestration planner"
```

---

## Task 3: YAML Agent Config Loader

**Files:**
- Create: `src/lib/agents/yaml-loader.ts`

- [ ] **Step 1: Create the YAML loader**

Create `src/lib/agents/yaml-loader.ts`:

```typescript
// ─── YAML Agent Config Loader ────────────────────────────────────────────────
// Loads AgentConfig from YAML files in ~/.gtm-os/agents/

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import type { AgentConfig, AgentSchedule, AgentStep } from './types'

const AGENTS_DIR = join(homedir(), '.gtm-os', 'agents')

interface RawYamlAgent {
  id: string
  name?: string
  description?: string
  steps: Array<{
    skillId: string
    input?: Record<string, unknown>
    continueOnError?: boolean
  }>
  schedule: {
    type: 'interval' | 'daily' | 'weekly' | 'cron'
    hour?: number
    minute?: number
    dayOfWeek?: number
    intervalMinutes?: number
  }
  maxRetries?: number
  timeoutMs?: number
}

export function loadAgentFromYaml(agentId: string): AgentConfig | null {
  const filePath = join(AGENTS_DIR, `${agentId}.yaml`)
  if (!existsSync(filePath)) return null

  const raw = yaml.load(readFileSync(filePath, 'utf-8')) as RawYamlAgent
  return parseAgentYaml(raw)
}

export function listYamlAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) return []
  return readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.ya?ml$/, ''))
}

function parseAgentYaml(raw: RawYamlAgent): AgentConfig {
  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error('Agent YAML must have an "id" field')
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error('Agent YAML must have at least one step')
  }
  if (!raw.schedule || !raw.schedule.type) {
    throw new Error('Agent YAML must have a "schedule" with "type"')
  }

  const steps: AgentStep[] = raw.steps.map(s => ({
    skillId: s.skillId,
    input: s.input ?? {},
    continueOnError: s.continueOnError ?? false,
  }))

  const schedule: AgentSchedule = {
    type: raw.schedule.type,
    hour: raw.schedule.hour,
    minute: raw.schedule.minute,
    dayOfWeek: raw.schedule.dayOfWeek,
    intervalMinutes: raw.schedule.intervalMinutes,
  }

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description ?? '',
    steps,
    schedule,
    maxRetries: raw.maxRetries ?? 2,
    timeoutMs: raw.timeoutMs ?? 300000,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/yaml-loader.ts
git commit -m "feat: add YAML agent config loader"
```

---

## Task 4: Wire YAML Loader into agent:run

**Files:**
- Modify: `src/cli/index.ts:729-743`

- [ ] **Step 1: Update agent:run to check YAML configs**

Replace the `agent:run` action body in `src/cli/index.ts` (lines 729-749):

```typescript
  .action(async (opts) => {
    const { BackgroundAgent } = await import('../lib/agents/runner')
    const { loadAgentFromYaml } = await import('../lib/agents/yaml-loader')

    let config

    // Try built-in agents first
    if (opts.agent === 'daily-linkedin-scraper') {
      if (!opts.postUrl) {
        console.error('Error: --post-url required for daily-linkedin-scraper agent')
        process.exit(1)
      }
      const { createDailyLinkedinScraperConfig } = await import('../lib/agents/examples/daily-linkedin-scraper')
      config = createDailyLinkedinScraperConfig(opts.postUrl)
    } else {
      // Try YAML config
      config = loadAgentFromYaml(opts.agent)
      if (!config) {
        const { listYamlAgents } = await import('../lib/agents/yaml-loader')
        const available = ['daily-linkedin-scraper', ...listYamlAgents()]
        console.error(`Unknown agent: ${opts.agent}. Available: ${available.join(', ')}`)
        process.exit(1)
      }
    }

    const agent = new BackgroundAgent(config)
    const log = await agent.run()
    console.log(`\nAgent run complete: ${log.status}`)
    console.log(`  Steps: ${log.steps.length}`)
    console.log(`  Duration: ${new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()}ms`)
  })
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: agent:run resolves YAML configs from ~/.gtm-os/agents/"
```

---

## Task 5: Interactive agent:create Command

**Files:**
- Create: `src/cli/commands/agent-create.ts`
- Modify: `src/cli/index.ts` (add command)

- [ ] **Step 1: Create the interactive wizard**

Create `src/cli/commands/agent-create.ts`:

```typescript
// ─── agent:create — Interactive Agent Scaffolder ─────────────────────────────

import { input, select, checkbox, confirm } from '@inquirer/prompts'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { getSkillRegistryReady } from '../../lib/skills/registry'

const AGENTS_DIR = join(homedir(), '.gtm-os', 'agents')

export async function runAgentCreate(): Promise<void> {
  console.log('\n🔧 Agent Creator\n')

  // Ensure directory
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true })
  }

  // 1. Agent ID
  const id = await input({
    message: 'Agent ID (kebab-case):',
    validate: (val) => {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(val)) return 'Must be kebab-case (e.g., my-agent)'
      if (existsSync(join(AGENTS_DIR, `${val}.yaml`))) return `Agent "${val}" already exists`
      return true
    },
  })

  // 2. Description
  const description = await input({
    message: 'Description:',
  })

  // 3. Select skills
  const registry = await getSkillRegistryReady()
  const allSkills = registry.list()

  const selectedSkillIds = await checkbox({
    message: 'Select skills to chain (space to select, enter to confirm):',
    choices: allSkills.map(s => ({
      name: `${s.id} — ${s.description.slice(0, 60)}`,
      value: s.id,
    })),
  })

  if (selectedSkillIds.length === 0) {
    console.log('No skills selected. Aborting.')
    return
  }

  // 4. Per-skill inputs
  const steps: Array<{ skillId: string; input: Record<string, unknown>; continueOnError: boolean }> = []

  for (const skillId of selectedSkillIds) {
    const skill = registry.get(skillId)
    if (!skill) continue

    console.log(`\n── ${skill.name} (${skillId}) ──`)

    const stepInput: Record<string, unknown> = {}
    const schema = skill.inputSchema as { properties?: Record<string, { type: string; description?: string; default?: unknown }> }

    if (schema?.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const defaultVal = prop.default !== undefined ? String(prop.default) : ''
        const answer = await input({
          message: `  ${key}${prop.description ? ` (${prop.description})` : ''}:`,
          default: defaultVal,
        })
        if (answer) {
          // Parse booleans and numbers
          if (prop.type === 'boolean') stepInput[key] = answer === 'true'
          else if (prop.type === 'number') stepInput[key] = Number(answer)
          else stepInput[key] = answer
        }
      }
    }

    const continueOnError = skillId !== selectedSkillIds[0]
      ? await confirm({ message: `  Continue to next step if ${skillId} fails?`, default: true })
      : false

    steps.push({ skillId, input: stepInput, continueOnError })
  }

  // 5. Schedule
  const scheduleType = await select({
    message: 'Schedule type:',
    choices: [
      { name: 'Daily', value: 'daily' as const },
      { name: 'Weekly', value: 'weekly' as const },
      { name: 'Interval (every N minutes)', value: 'interval' as const },
    ],
  })

  const schedule: Record<string, unknown> = { type: scheduleType }

  if (scheduleType === 'daily' || scheduleType === 'weekly') {
    const hour = await input({ message: 'Hour (0-23):', default: '8' })
    const minute = await input({ message: 'Minute (0-59):', default: '0' })
    schedule.hour = parseInt(hour, 10)
    schedule.minute = parseInt(minute, 10)
  }

  if (scheduleType === 'weekly') {
    const day = await select({
      message: 'Day of week:',
      choices: [
        { name: 'Monday', value: 1 },
        { name: 'Tuesday', value: 2 },
        { name: 'Wednesday', value: 3 },
        { name: 'Thursday', value: 4 },
        { name: 'Friday', value: 5 },
        { name: 'Saturday', value: 6 },
        { name: 'Sunday', value: 0 },
      ],
    })
    schedule.dayOfWeek = day
  }

  if (scheduleType === 'interval') {
    const intervalMin = await input({ message: 'Interval (minutes):', default: '60' })
    schedule.intervalMinutes = parseInt(intervalMin, 10)
  }

  // 6. Retry/timeout
  const maxRetries = await input({ message: 'Max retries per step:', default: '2' })
  const timeoutMs = await input({ message: 'Timeout per step (ms):', default: '300000' })

  // 7. Build and write YAML
  const agentConfig = {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description,
    steps: steps.map(s => ({
      skillId: s.skillId,
      input: s.input,
      ...(s.continueOnError ? { continueOnError: true } : {}),
    })),
    schedule,
    maxRetries: parseInt(maxRetries, 10),
    timeoutMs: parseInt(timeoutMs, 10),
  }

  const yamlStr = yaml.dump(agentConfig, { lineWidth: 120, noRefs: true })
  const filePath = join(AGENTS_DIR, `${id}.yaml`)
  writeFileSync(filePath, yamlStr)

  console.log(`\n✓ Agent written to ${filePath}`)
  console.log(`\nRun it now:  yalc-gtm agent:run --agent ${id}`)

  // 8. Offer install
  const doInstall = await confirm({ message: 'Install as launchd service now?', default: false })
  if (doInstall) {
    const { execSync } = await import('child_process')
    const { join: pathJoin } = await import('path')
    const scriptPath = pathJoin(process.cwd(), 'scripts', 'install-agent.sh')
    try {
      const hour = String(schedule.hour ?? 8)
      const minute = String(schedule.minute ?? 0)
      const output = execSync(
        `bash "${scriptPath}" "${id.replace(/[^a-zA-Z0-9_-]/g, '')}" "${hour}" "${minute}"`,
        { encoding: 'utf-8' },
      )
      console.log(output)
    } catch (err) {
      console.error('Installation failed:', err instanceof Error ? err.message : err)
    }
  }
}
```

- [ ] **Step 2: Add agent:create to CLI**

In `src/cli/index.ts`, add this block before the `agent:run` command (before line 723):

```typescript
// ─── agent:create ─────────────────────────────────────────────────────────
program
  .command('agent:create')
  .description('Interactively create a new background agent config')
  .action(async () => {
    const { runAgentCreate } = await import('./commands/agent-create')
    await runAgentCreate()
  })
```

- [ ] **Step 3: Create commands directory if needed**

Run: `mkdir -p src/cli/commands`

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/agent-create.ts src/cli/index.ts
git commit -m "feat: add interactive agent:create scaffolder"
```

---

## Task 6: Setup Wizard

**Files:**
- Modify: `src/lib/config/setup.ts`
- Modify: `src/cli/index.ts` (add --wizard flag)

- [ ] **Step 1: Add runSetupWizard to setup.ts**

Append to the bottom of `src/lib/config/setup.ts` (after `runSetup`):

```typescript
const OPTIONAL_KEYS = [
  { key: 'FULLENRICH_API_KEY', label: 'FullEnrich (email enrichment)', url: 'https://app.fullenrich.com/settings' },
  { key: 'INSTANTLY_API_KEY', label: 'Instantly (cold email)', url: 'https://instantly.ai/settings/api' },
  { key: 'ORTHOGONAL_API_KEY', label: 'Orthogonal (universal API gateway)', url: 'https://orthogonal.com/sign-up' },
]

export async function runSetupWizard(): Promise<void> {
  const { password, confirm, input } = await import('@inquirer/prompts')
  const { randomBytes } = await import('crypto')

  console.log('\n🔧 GTM-OS Setup Wizard\n')

  // 1. Ensure directory
  if (!existsSync(GTM_OS_DIR)) {
    mkdirSync(GTM_OS_DIR, { recursive: true })
    console.log(`Created ${GTM_OS_DIR}`)
  }

  // 2. Ensure config
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG))
    console.log(`Created default config at ${CONFIG_PATH}`)
  }

  // 3. Read existing .env.local
  const envLocalPath = join(process.cwd(), '.env.local')
  const existingEnv: Record<string, string> = {}
  if (existsSync(envLocalPath)) {
    const content = readFileSync(envLocalPath, 'utf-8')
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/)
      if (match) existingEnv[match[1]] = match[2]
    }
  }

  const alreadySet = Object.keys(existingEnv)
  if (alreadySet.length > 0) {
    console.log(`Found ${alreadySet.length} key(s) already in .env.local\n`)
  }

  const collectedKeys: Record<string, string> = { ...existingEnv }

  // 4. Required keys
  console.log('── Required Keys ──\n')

  for (const { key, label, url } of REQUIRED_KEYS) {
    if (existingEnv[key]) {
      console.log(`  ✓ ${label} (${key}) — already set`)
      continue
    }

    const value = await password({
      message: `${label}\n  Get yours at: ${url}\n  Paste your key:`,
      mask: '*',
    })

    if (!value) {
      console.log(`  ⚠ Skipped ${key}`)
      continue
    }

    collectedKeys[key] = value

    // Live validate
    process.env[key] = value
    const validation = await validateProviderForKey(key)
    if (validation) {
      console.log(`  ${validation.valid ? '✓' : '✗'} ${validation.valid ? 'Valid' : validation.error}\n`)
    }
  }

  // 5. Auto-generate crypto keys
  console.log('\n── Auto-Generated Keys ──\n')

  if (!collectedKeys.ENCRYPTION_KEY) {
    collectedKeys.ENCRYPTION_KEY = randomBytes(32).toString('hex')
    console.log('  ✓ ENCRYPTION_KEY generated')
  } else {
    console.log('  ✓ ENCRYPTION_KEY already set')
  }

  if (!collectedKeys.DATABASE_URL) {
    collectedKeys.DATABASE_URL = 'file:./gtm-os.db'
    console.log('  ✓ DATABASE_URL set to local SQLite')
  }

  const wantApiToken = await confirm({
    message: 'Generate GTM_OS_API_TOKEN for /api/* route protection?',
    default: true,
  })
  if (wantApiToken && !collectedKeys.GTM_OS_API_TOKEN) {
    collectedKeys.GTM_OS_API_TOKEN = randomBytes(32).toString('hex')
    console.log('  ✓ GTM_OS_API_TOKEN generated')
  }

  // 6. Optional keys
  console.log('\n── Optional Keys (press Enter to skip) ──\n')

  for (const { key, label, url } of OPTIONAL_KEYS) {
    if (existingEnv[key]) {
      console.log(`  ✓ ${label} — already set`)
      continue
    }

    const value = await input({
      message: `${label} (${url}):`,
      default: '',
    })

    if (value) {
      collectedKeys[key] = value
    }
  }

  // 7. Write .env.local
  console.log('\n── Writing Configuration ──\n')

  const envContent = Object.entries(collectedKeys)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
  writeFileSync(envLocalPath, envContent)
  console.log(`  ✓ ${Object.keys(collectedKeys).length} keys written to .env.local`)

  // 8. Run regular setup (provider validation + doctor)
  console.log('')
  await runSetup()

  // 9. Next steps
  console.log('\n── Next Steps ──')
  console.log('  yalc-gtm onboard --linkedin <your-linkedin-url> --website <your-website-url>')
  console.log('  yalc-gtm doctor')
  console.log('')
}

async function validateProviderForKey(key: string): Promise<ProviderValidation | null> {
  try {
    switch (key) {
      case 'ANTHROPIC_API_KEY': {
        const { getAnthropicClient } = await import('../ai/client')
        const client = getAnthropicClient()
        await Promise.race([
          client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        return { provider: 'Anthropic', valid: true }
      }
      case 'NOTION_API_KEY': {
        const { notionService } = await import('../services/notion')
        await Promise.race([
          notionService.search('', { property: 'object', value: 'page' }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        return { provider: 'Notion', valid: true }
      }
      default:
        return null
    }
  } catch (err) {
    return { provider: key, valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 2: Add --wizard flag to setup command in CLI**

In `src/cli/index.ts`, find the `setup` command. It should look something like:

```typescript
program
  .command('setup')
  .description('...')
  .action(async () => {
    const { runSetup } = await import('../lib/config/setup')
    await runSetup()
  })
```

Replace with:

```typescript
program
  .command('setup')
  .description('Check API keys and provider connectivity')
  .option('--wizard', 'Interactive guided setup for first-time users')
  .action(async (opts) => {
    if (opts.wizard) {
      const { runSetupWizard } = await import('../lib/config/setup')
      await runSetupWizard()
    } else {
      const { runSetup } = await import('../lib/config/setup')
      await runSetup()
    }
  })
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/config/setup.ts src/cli/index.ts
git commit -m "feat: add interactive setup --wizard for first-time users"
```

---

## Task 7: Final Verification + Push

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All existing tests pass

- [ ] **Step 3: Smoke test setup wizard**

Run: `yalc-gtm setup --help`
Expected: Shows `--wizard` option in help output

- [ ] **Step 4: Smoke test agent:create**

Run: `yalc-gtm agent:create --help`
Expected: Shows command description

- [ ] **Step 5: Push to both remotes**

```bash
git push origin main
git push internal main
```
