import { NextRequest } from 'next/server'
import { db, rawClient } from '@/lib/db'
import { conversations, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getAnthropicClient, PLANNER_MODEL } from '@/lib/ai/client'
import {
  actionTools,
  buildSystemPrompt,
  buildWorkflowFromAction,
} from '@/lib/ai/workflow-planner'
import type { StreamEvent, KnowledgeChunk } from '@/lib/ai/types'
import { buildFrameworkContext } from '@/lib/framework/context'
import type { GTMFramework } from '@/lib/framework/types'
import { getCollector } from '@/lib/signals/collector'
export const runtime = 'nodejs'
export const maxDuration = 60

// Encode a StreamEvent as an SSE line
function sseEvent(event: StreamEvent & { conversationId?: string }): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

// Sanitize user input for FTS5 MATCH — strip operators and quote each term
function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/['"*]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term}"`)
    .join(' ')
}

// Search knowledge base using SQLite FTS5
async function searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
  try {
    const sanitized = sanitizeFtsQuery(query)
    if (!sanitized) return []

    const results = await rawClient.execute({
      sql: `SELECT ki.id, ki.title, ki.type,
                   snippet(knowledge_fts, 2, '', '', '...', 64) as snippet,
                   ki.extracted_text,
                   LENGTH(ki.extracted_text) as text_length
            FROM knowledge_fts
            JOIN knowledge_items ki ON ki.id = knowledge_fts.item_id
            WHERE knowledge_fts MATCH ?
            ORDER BY rank
            LIMIT 5`,
      args: [sanitized],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.rows.map((row: any) => ({
      itemId: row.id as string,
      title: row.title as string,
      type: row.type as KnowledgeChunk['type'],
      snippet: row.snippet as string,
      extractedText: row.extracted_text as string,
      textLength: row.text_length as number,
    }))
  } catch {
    // FTS table might be empty on first run — not an error
    return []
  }
}

// Get connected API provider names from the vault
async function getConnectedProviders(): Promise<string[]> {
  try {
    const connections = await db.query.apiConnections.findMany({
      where: (t, { eq }) => eq(t.status, 'active'),
    })
    return connections.map((c) => c.provider)
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  const { message, conversationId, attachedRows } = await req.json() as {
    message: string
    conversationId?: string
    attachedRows?: Record<string, unknown>[]
  }

  if (!message?.trim()) {
    return new Response('Message is required', { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent & { conversationId?: string }) => {
        controller.enqueue(encoder.encode(sseEvent(event)))
      }

      try {
        // ── 1. Create or fetch conversation ──────────────────────────────
        let convId = conversationId

        if (!convId) {
          const [newConv] = await db
            .insert(conversations)
            .values({
              title: message.slice(0, 60),
            })
            .returning({ id: conversations.id })
          convId = newConv.id
        }

        // ── 2. Save user message ──────────────────────────────────────────
        await db.insert(messages).values({
          conversationId: convId,
          role: 'user',
          content: message,
          messageType: 'text',
        })

        // ── 3. Fetch knowledge context + connected providers + framework ──
        const [knowledgeChunks, connectedProviders, frameworkRow] = await Promise.all([
          searchKnowledge(message),
          getConnectedProviders(),
          db.query.frameworks.findFirst({
            where: (t, { eq }) => eq(t.userId, 'default'),
          }).catch(() => null),
        ])
        const frameworkContext = await buildFrameworkContext(
          (frameworkRow?.data as GTMFramework) ?? null
        )

        // ── 4. Build conversation history for Claude ──────────────────────
        const history = await db.query.messages.findMany({
          where: eq(messages.conversationId, convId),
          orderBy: (t, { asc }) => [asc(t.createdAt)],
          limit: 20, // last 20 messages for context window management
        })

        const anthropicMessages: { role: 'user' | 'assistant'; content: string }[] =
          history
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            }))

        // ── 5. Stream from Claude ─────────────────────────────────────────
        const anthropic = getAnthropicClient()
        const systemPrompt = buildSystemPrompt(knowledgeChunks, connectedProviders, frameworkContext)

        // If CSV rows are attached, mention them in the user message context
        let enrichedMessage = message
        if (attachedRows && attachedRows.length > 0) {
          enrichedMessage += `\n\n[User uploaded ${attachedRows.length} rows as CSV. First row keys: ${Object.keys(attachedRows[0]).join(', ')}]`
        }

        // Rebuild last message with enriched content
        if (anthropicMessages.length > 0) {
          anthropicMessages[anthropicMessages.length - 1].content = enrichedMessage
        }

        // Send conversation ID so frontend can track it
        send({ type: 'text_delta', content: '', conversationId: convId })

        const claudeStream = await anthropic.messages.create({
          model: PLANNER_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools: actionTools,
          tool_choice: { type: 'auto' },
          messages: anthropicMessages,
          stream: true,
        })

        let finalText = ''
        let toolUseBlock: { type: string; name: string; input: Record<string, unknown> } | null = null
        let toolInputBuffer = ''

        for await (const chunk of claudeStream) {
          if (chunk.type === 'content_block_start') {
            if (chunk.content_block.type === 'tool_use') {
              toolUseBlock = {
                type: 'tool_use',
                name: chunk.content_block.name,
                input: {},
              }
              toolInputBuffer = ''
            }
          } else if (chunk.type === 'content_block_delta') {
            if (chunk.delta.type === 'text_delta') {
              finalText += chunk.delta.text
              send({ type: 'text_delta', content: chunk.delta.text })
            } else if (chunk.delta.type === 'input_json_delta' && toolUseBlock) {
              toolInputBuffer += chunk.delta.partial_json
            }
          } else if (chunk.type === 'content_block_stop') {
            if (toolUseBlock && toolInputBuffer) {
              try {
                toolUseBlock.input = JSON.parse(toolInputBuffer)
              } catch {
                // Malformed tool input — continue
              }
            }
          } else if (chunk.type === 'message_stop') {
            // Map action tool calls to fixed workflows
            const actionNames = ['find_leads', 'enrich_leads', 'qualify_leads']
            if (toolUseBlock && actionNames.includes(toolUseBlock.name)) {
              const workflow = buildWorkflowFromAction(toolUseBlock.name, toolUseBlock.input)
              // Attach seedRows for enrich/qualify when CSV was uploaded
              send({
                type: 'workflow_proposal',
                workflow,
                ...(attachedRows && attachedRows.length > 0 ? { seedRows: attachedRows } : {}),
              } as StreamEvent)
              finalText = "Here's what I'll do:"
            }
          }
        }

        // ── 6. Save assistant message to DB ──────────────────────────────
        const isAction = toolUseBlock && ['find_leads', 'enrich_leads', 'qualify_leads'].includes(toolUseBlock.name)

        await db.insert(messages).values({
          conversationId: convId,
          role: 'assistant',
          content: finalText || '',
          messageType: isAction ? 'workflow_proposal' : 'text',
          metadata: isAction ? { workflowDefinition: toolUseBlock!.input } : null,
        })

        // ── 7. Detect corrections and emit signals ─────────────────────
        const correctionPrefixes = ['no,', 'no ', 'actually', 'not that', "that's wrong", 'wrong', 'i meant', 'what i meant']
        const lowerMessage = message.toLowerCase().trim()
        const isCorrection = correctionPrefixes.some(p => lowerMessage.startsWith(p))

        if (isCorrection && history.length >= 2) {
          const lastAssistant = history.filter(m => m.role === 'assistant').pop()
          if (lastAssistant) {
            await getCollector().emit({
              type: 'chat_correction',
              category: 'qualification',
              data: {
                userMessage: message,
                previousAssistantMessage: lastAssistant.content.slice(0, 500),
              },
              conversationId: convId,
            })
          }
        }

        send({ type: 'done' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        send({ type: 'error', error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
