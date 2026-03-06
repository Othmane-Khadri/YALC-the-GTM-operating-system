import type { Skill, SkillEvent, SkillContext } from '../types'
import { db } from '../../db'
import { resultRows } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const exportDataSkill: Skill = {
  id: 'export-data',
  name: 'Export Data',
  version: '1.0.0',
  description: 'Export a result set as CSV or JSON. No external provider needed — reads directly from GTM-OS data.',
  category: 'data',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to export' },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: 'Export format',
        default: 'csv',
      },
    },
    required: ['resultSetId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string' },
      content: { type: 'string' },
      rowCount: { type: 'number' },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, format = 'csv' } = input as {
      resultSetId: string
      format?: 'csv' | 'json'
    }

    yield { type: 'progress', message: 'Loading result set...', percent: 10 }

    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` }
      return
    }

    yield { type: 'progress', message: `Formatting ${rows.length} rows as ${format.toUpperCase()}...`, percent: 40 }

    const parsedRows = rows.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? row)
      return data as Record<string, unknown>
    })

    let content: string

    if (format === 'json') {
      content = JSON.stringify(parsedRows, null, 2)
    } else {
      if (parsedRows.length === 0) {
        content = ''
      } else {
        const headers = Object.keys(parsedRows[0])
        const csvRows = [
          headers.join(','),
          ...parsedRows.map(row =>
            headers
              .map(h => {
                const val = String(row[h] ?? '')
                return val.includes(',') || val.includes('"') || val.includes('\n')
                  ? `"${val.replace(/"/g, '""')}"`
                  : val
              })
              .join(',')
          ),
        ]
        content = csvRows.join('\n')
      }
    }

    yield { type: 'progress', message: 'Export ready.', percent: 90 }

    yield {
      type: 'result',
      data: {
        format,
        content,
        rowCount: parsedRows.length,
      },
    }

    yield { type: 'progress', message: `Exported ${parsedRows.length} rows as ${format.toUpperCase()}.`, percent: 100 }
  },
}
