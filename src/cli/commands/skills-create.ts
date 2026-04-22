import { createInterface } from 'readline'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Interactive wizard for creating markdown skills
// ---------------------------------------------------------------------------

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

interface InputDef {
  name: string
  description: string
  required: boolean
}

export async function runSkillsCreate(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log('\n-- Create a Markdown Skill --\n')

    // 1. Name
    const name = await ask(rl, 'Skill name (lowercase-with-dashes): ')
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
      console.error('Invalid name. Must be lowercase alphanumeric with hyphens, starting with a letter.')
      return
    }

    // 2. Description
    const description = await ask(rl, 'Description: ')
    if (!description) {
      console.error('Description is required.')
      return
    }

    // 3. Category
    const categories = ['research', 'content', 'outreach', 'analysis', 'data', 'integration']
    console.log(`\nCategories: ${categories.join(', ')}`)
    const category = await ask(rl, 'Category: ')
    if (!categories.includes(category)) {
      console.error(`Invalid category. Choose from: ${categories.join(', ')}`)
      return
    }

    // 4. Inputs
    const inputs: InputDef[] = []
    console.log('\nDefine input fields (press Enter with empty name to finish):')
    while (true) {
      const inputName = await ask(rl, `  Input name: `)
      if (!inputName) break
      const inputDesc = await ask(rl, `  Description for "${inputName}": `)
      const requiredStr = await ask(rl, `  Required? (y/n, default y): `)
      const required = requiredStr.toLowerCase() !== 'n'
      inputs.push({ name: inputName, description: inputDesc || inputName, required })
    }

    if (inputs.length === 0) {
      console.error('At least one input is required.')
      return
    }

    // 5. Provider
    console.log('\nAvailable providers: firecrawl, crustdata, fullenrich, unipile, notion, instantly, mock')
    console.log('(Or any MCP provider you have installed)')
    const provider = await ask(rl, 'Provider: ')
    if (!provider) {
      console.error('Provider is required.')
      return
    }

    // 6. Capabilities
    console.log('\nCapabilities: search, enrich, qualify, filter, export, custom')
    const capInput = await ask(rl, 'Capabilities (comma-separated): ')
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
      const overwrite = await ask(rl, `\n${filePath} already exists. Overwrite? (y/n): `)
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Aborted.')
        return
      }
    }

    writeFileSync(filePath, content)
    console.log(`\nSkill created: ${filePath}`)
    console.log(`\nThe skill is registered on next CLI run. Verify with:`)
    console.log(`  npx tsx src/cli/index.ts skills:info md:${name}`)
    console.log(`\nEdit the prompt template in the file to customize the skill behavior.`)
  } finally {
    rl.close()
  }
}
