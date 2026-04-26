import { input as promptInput, confirm as promptConfirm } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { requireTTY } from '../../lib/cli/tty'

// ---------------------------------------------------------------------------
// Interactive wizard for creating markdown skills
// ---------------------------------------------------------------------------

interface InputDef {
  name: string
  description: string
  required: boolean
}

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
  console.log('\n-- Create a Markdown Skill --\n')

  // 1. Name
  const name = await promptInput({
    message: 'Skill name (lowercase-with-dashes):',
    validate: (val) => /^[a-z][a-z0-9-]*$/.test(val.trim())
      ? true
      : 'Must be lowercase alphanumeric with hyphens, starting with a letter.',
  })

  // 2. Description
  const description = await promptInput({
    message: 'Description:',
    validate: (val) => val.trim().length > 0 ? true : 'Description is required.',
  })

  // 3. Category
  const categories = ['research', 'content', 'outreach', 'analysis', 'data', 'integration']
  console.log(`\nCategories: ${categories.join(', ')}`)
  const category = await promptInput({
    message: 'Category:',
    validate: (val) => categories.includes(val.trim())
      ? true
      : `Choose from: ${categories.join(', ')}`,
  })

  // 4. Inputs
  const inputs: InputDef[] = []
  console.log('\nDefine input fields (leave name empty to finish):')
  while (true) {
    const inputName = (await promptInput({ message: '  Input name (empty to finish):' })).trim()
    if (!inputName) break
    const inputDesc = (await promptInput({ message: `  Description for "${inputName}":` })).trim()
    const required = await promptConfirm({ message: `  Required?`, default: true })
    inputs.push({ name: inputName, description: inputDesc || inputName, required })
  }

  if (inputs.length === 0) {
    console.error('At least one input is required.')
    return
  }

  // 5. Provider
  console.log('\nAvailable providers: firecrawl, crustdata, fullenrich, unipile, notion, instantly, mock')
  console.log('(Or any MCP provider you have installed)')
  const provider = await promptInput({
    message: 'Provider:',
    validate: (val) => val.trim().length > 0 ? true : 'Provider is required.',
  })

  // 6. Capabilities
  console.log('\nCapabilities: search, enrich, qualify, filter, export, custom')
  const capInput = await promptInput({ message: 'Capabilities (comma-separated):' })
  const capabilities = capInput
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)

  // 7. Build the template
  const inputsYaml = inputs
    .map(inp => {
      const lines = [`  - name: ${inp.name}`, `    description: ${inp.description}`]
      if (!inp.required) lines.push(`    required: false`)
      return lines.join('\n')
    })
    .join('\n')

  const templateVars = inputs.map(inp => `{{${inp.name}}}`).join(', ')
  const capArray = capabilities.length > 0 ? `[${capabilities.join(', ')}]` : '[custom]'

  const content = `---
name: ${name}
description: ${description}
category: ${category}
inputs:
${inputsYaml}
provider: ${provider}
capabilities: ${capArray}
output: structured_json
---

You are executing the "${name}" skill with these inputs: ${templateVars}

${inputs.map(inp => `- **${inp.name}**: {{${inp.name}}}`).join('\n')}

Analyze the inputs and return structured results as JSON.

Return a JSON object with your findings:
\`\`\`json
{
${inputs.map(inp => `  "${inp.name}_result": ""`).join(',\n')}
}
\`\`\`
`

  // 8. Save
  const skillsDir = join(homedir(), '.gtm-os', 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const filePath = join(skillsDir, `${name}.md`)

  if (existsSync(filePath)) {
    const overwrite = await promptConfirm({ message: `\n${filePath} already exists. Overwrite?`, default: false })
    if (!overwrite) {
      console.log('Aborted.')
      return
    }
  }

  writeFileSync(filePath, content)
  console.log(`\nSkill created: ${filePath}`)
  console.log(`\nRun it:`)
  const firstInput = inputs[0]
  const moreInputs = inputs.length > 1 ? ' --input ...' : ''
  if (firstInput) {
    console.log(`  yalc-gtm skills:run md:${name} --input ${firstInput.name}=<value>${moreInputs}`)
  } else {
    console.log(`  yalc-gtm skills:run md:${name}`)
  }
  console.log(`Inspect schema:`)
  console.log(`  yalc-gtm skills:info md:${name}`)
  console.log(`\nEdit the prompt template in the file to customize the skill behavior.`)
}
