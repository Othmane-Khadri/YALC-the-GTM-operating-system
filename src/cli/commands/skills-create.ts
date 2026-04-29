import { input as promptInput, confirm as promptConfirm } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { requireTTY } from '../../lib/cli/tty'

// ---------------------------------------------------------------------------
// LLM-assisted wizard for creating markdown skills (0.9.F).
// ---------------------------------------------------------------------------
//
// Replaces the skeletal stub generator that 0.7.0 / 0.8.0 emitted. Flow:
//   1. Collect four primitives — name, description, category, capability.
//   2. Call the `reasoning` capability to draft a working body +
//      output_schema + two example inputs.
//   3. Show the result; user accepts (writes file) or types corrections
//      that get appended into the next prompt.
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['research', 'content', 'outreach', 'analysis', 'data', 'integration']

export async function runSkillsCreate(): Promise<void> {
  requireTTY('skills:create')
  try {
    await runSkillsCreateInner()
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'ExitPromptError') {
      console.error('\n  skills:create cancelled — no input received.\n')
      process.exit(1)
    }
    throw err
  }
}

async function runSkillsCreateInner(): Promise<void> {
  console.log('\n-- Create a Markdown Skill (LLM-drafted) --\n')

  const name = await promptInput({
    message: 'Skill name (lowercase-with-dashes):',
    validate: (val) =>
      /^[a-z][a-z0-9-]*$/.test(val.trim())
        ? true
        : 'Must be lowercase alphanumeric with hyphens, starting with a letter.',
  })
  const description = await promptInput({
    message: 'Description:',
    validate: (val) => (val.trim().length > 0 ? true : 'Description is required.'),
  })
  console.log(`\nCategories: ${VALID_CATEGORIES.join(', ')}`)
  const category = await promptInput({
    message: 'Category:',
    validate: (val) =>
      VALID_CATEGORIES.includes(val.trim()) ? true : `Choose from: ${VALID_CATEGORIES.join(', ')}`,
  })
  const capability = await promptInput({
    message: 'Capability the skill calls (e.g. reasoning, web-fetch, news-feed):',
    validate: (val) => (val.trim().length > 0 ? true : 'Capability is required.'),
  })

  const { runSkillDraft, renderSkillFile } = await import('../../lib/skills/llm-draft.js')

  let corrections: string | undefined
  for (let attempt = 0; attempt < 5; attempt++) {
    console.log(`\n  Drafting skill via reasoning capability${corrections ? ' (with corrections)' : ''}…`)
    let draft
    try {
      draft = await runSkillDraft({ name, description, category, capability, corrections })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ Draft failed: ${msg}`)
      const retry = await promptConfirm({ message: 'Retry?', default: true })
      if (!retry) return
      continue
    }

    console.log('\n  -- Drafted skill --')
    console.log(`  Inputs:        ${draft.inputs.map((i) => i.name).join(', ')}`)
    console.log(`  Output schema: ${Object.keys(draft.output_schema).join(', ')}`)
    console.log(`  Body preview:  ${draft.body.slice(0, 120)}${draft.body.length > 120 ? '…' : ''}`)

    const accept = await promptConfirm({ message: 'Accept this draft?', default: true })
    if (accept) {
      const skillsDir = join(homedir(), '.gtm-os', 'skills')
      mkdirSync(skillsDir, { recursive: true })
      const filePath = join(skillsDir, `${name}.md`)
      if (existsSync(filePath)) {
        const overwrite = await promptConfirm({
          message: `\n${filePath} already exists. Overwrite?`,
          default: false,
        })
        if (!overwrite) {
          console.log('Aborted.')
          return
        }
      }
      const content = renderSkillFile({ name, description, category, capability, draft })
      writeFileSync(filePath, content)
      console.log(`\nSkill created: ${filePath}`)
      console.log(`Run it: yalc-gtm skills:run md:${name} --input ...`)
      return
    }

    corrections = (
      await promptInput({
        message: 'Type corrections to feed the next draft (empty to abort):',
      })
    ).trim()
    if (!corrections) {
      console.log('Aborted — no file written.')
      return
    }
  }
  console.error('  Hit max draft attempts. Aborting.')
  process.exit(1)
}
