import { NextRequest } from 'next/server'
import { createClient } from '@libsql/client'
import { db } from '@/lib/db'
import { conversations, messages } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const rawClient = createClient({ url: process.env.DATABASE_URL ?? 'file:./gtm-os.db' })
import { getAnthropicClient, PLANNER_MODEL } from '@/lib/ai/client'
import {
  proposeWorkflowTool,
  buildSystemPrompt,
  parseWorkflowFromToolUse,
} from '@/lib/ai/workflow-planner'
import type { StreamEvent, KnowledgeChunk } from '@/lib/ai/types'

export const runtime = 'nodejs'

// Encode a StreamEvent as an SSE line
function sseEvent(event: StreamEvent & { conversationId?: string }): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

// Search knowledge base using SQLite FTS5
async function searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
  try {
    const results = await rawClient.execute({
      sql: `SELECT ki.id, ki.title, ki.type,
                   snippet(knowledge_fts, 2, '', '', '...', 25) as snippet
            FROM knowledge_fts
            JOIN knowledge_items ki ON ki.id = knowledge_fts.item_id
            WHERE knowledge_fts MATCH ?
            ORDER BY rank
            LIMIT 3`,
      args: [query],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.rows.map((row: any) => ({
      itemId: row.id as string,
      title: row.title as string,
      type: row.type as KnowledgeChunk['type'],
      snippet: row.snippet as string,
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
  const { message, conversationId } = await req.json() as {
    message: string
    conversationId?: string
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

        // ── 3. Fetch knowledge context + connected providers ──────────────
        const [knowledgeChunks, connectedProviders] = await Promise.all([
          searchKnowledge(message),
          getConnectedProviders(),
        ])

        // ── 4. Build conversation history for Claude ──────────────────────
        const history = await db.query.messages.findMany({
          where: eq(messages.conversationId, convId),
          orderBy: (t, { asc }) => [asc(t.createdAt)],
          limit: 20, // last 20 messages for context window management
        })

        const anthropicMessages: { role: 'user' | 'assistant'; content: string }[] =
          history.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))

        // ── 5. Stream from Claude ─────────────────────────────────────────
        const anthropic = getAnthropicClient()
        const systemPrompt = buildSystemPrompt(knowledgeChunks, connectedProviders)

        // Send conversation ID so frontend can track it
        send({ type: 'text_delta', content: '', conversationId: convId })

        const claudeStream = await anthropic.messages.create({
          model: PLANNER_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          tools: [proposeWorkflowTool],
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
            // If a workflow was proposed, emit it
            if (toolUseBlock?.name === 'propose_workflow' && toolUseBlock.input) {
              const workflow = parseWorkflowFromToolUse(toolUseBlock.input)
              send({ type: 'workflow_proposal', workflow })
              finalText = "Here's a workflow I'd suggest for your goal:"
            }
          }
        }

        // ── 6. Save assistant message to DB ──────────────────────────────
        await db.insert(messages).values({
          conversationId: convId,
          role: 'assistant',
          content: finalText || '',
          messageType: toolUseBlock?.name === 'propose_workflow'
            ? 'workflow_proposal'
            : 'text',
          metadata: toolUseBlock?.name === 'propose_workflow'
            ? { workflowDefinition: toolUseBlock.input }
            : null,
        })

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
