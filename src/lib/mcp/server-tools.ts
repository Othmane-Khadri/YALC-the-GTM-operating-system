import { getRegistry } from '../providers/registry'
import { db } from '../db'
import { frameworks, knowledgeItems } from '../db/schema'
import { buildFrameworkContext } from '../framework/context'
import type { GTMFramework } from '../framework/types'
import type { WorkflowStepInput } from '../providers/types'

export async function handleSearchLeads(args: {
  query: string
  count?: number
  filters?: Record<string, unknown>
}) {
  const registry = getRegistry()
  const executor = registry.resolve({ stepType: 'search', provider: 'mock' })

  const step: WorkflowStepInput = {
    stepIndex: 0,
    title: args.query,
    stepType: 'search',
    provider: executor.id,
    description: args.query,
    estimatedRows: args.count ?? 10,
    config: {
      query: args.query,
      count: args.count ?? 10,
      ...args.filters,
    },
  }

  const context = {
    frameworkContext: '',
    batchSize: args.count ?? 10,
    totalRequested: args.count ?? 10,
  }

  // Try to load framework context
  try {
    const [fw] = await db.select().from(frameworks).limit(1)
    if (fw?.data) {
      context.frameworkContext = await buildFrameworkContext(fw.data as GTMFramework)
    }
  } catch {
    // proceed without framework
  }

  const allRows: Record<string, unknown>[] = []
  for await (const batch of executor.execute(step, context)) {
    allRows.push(...batch.rows)
  }

  const columns = executor.getColumnDefinitions(step)

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ resultCount: allRows.length, columns, rows: allRows }),
    }],
  }
}

export async function handleGetFramework(args: { sections?: string[] }) {
  const [fw] = await db.select().from(frameworks).limit(1)

  if (!fw) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ framework: null, message: 'No framework configured yet.' }) }],
    }
  }

  const data = fw.data as GTMFramework
  if (args.sections && args.sections.length > 0) {
    const filtered: Record<string, unknown> = {}
    for (const section of args.sections) {
      if (section in data) {
        filtered[section] = (data as unknown as Record<string, unknown>)[section]
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ framework: filtered }) }],
    }
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ framework: data }) }],
  }
}

export async function handleGetLearnings(args: { confidence?: string; segment?: string }) {
  const [fw] = await db.select().from(frameworks).limit(1)
  const data = fw?.data as GTMFramework | undefined
  let learnings = data?.learnings ?? []

  if (args.confidence) {
    learnings = learnings.filter(l => l.confidence === args.confidence)
  }
  if (args.segment) {
    learnings = learnings.filter(l => l.segment === args.segment)
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ learnings }) }],
  }
}

export async function handleQualifyLead(args: { lead: Record<string, unknown>; segment?: string }) {
  const [fw] = await db.select().from(frameworks).limit(1)
  const data = fw?.data as GTMFramework | undefined
  const frameworkContext = data ? await buildFrameworkContext(data) : ''

  // Placeholder qualification — real Claude call would go here
  const score = frameworkContext ? 65 : 50
  const reason = frameworkContext
    ? 'Scored based on ICP framework match. Full Claude qualification coming soon.'
    : 'No framework configured. Configure ICP framework for accurate qualification.'

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ score, reason, lead: args.lead }),
    }],
  }
}

export async function handleGetAvailableProviders() {
  const registry = getRegistry()
  const providers = registry.getAll()

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ providers }),
    }],
  }
}
