// ─── CSV / JSON Export Adapter ──────────────────────────────────────────────

import { writeFileSync } from 'fs'
import { join } from 'path'
import type { ExportAdapter, ExportOptions, ExportResult } from '../types'

/** Escape a CSV cell value (RFC 4180). */
function escapeCsvCell(val: unknown): string {
  const str = val == null ? '' : String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Filter data to selected fields. If no fields specified, return all. */
function selectFields(
  data: Record<string, unknown>[],
  fields?: string[],
): Record<string, unknown>[] {
  if (!fields || fields.length === 0) return data
  return data.map(row => {
    const filtered: Record<string, unknown> = {}
    for (const f of fields) {
      filtered[f] = row[f] ?? ''
    }
    return filtered
  })
}

/** Generate a default filename when destination is a directory or empty. */
function defaultFilename(format: string, count: number): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `export_${date}_${count}.${format}`
}

// ─── CSV Adapter ──────────────────────────────────────────────────────────────

export const csvAdapter: ExportAdapter = {
  id: 'csv',
  name: 'CSV Export',
  description: 'Export data as a comma-separated values file with proper escaping.',

  async export(data, options) {
    const filtered = selectFields(data, options.fields)
    const errors: string[] = []

    if (filtered.length === 0) {
      return { success: true, recordsExported: 0, destination: '', errors: ['No data to export'] }
    }

    // Derive headers from first row
    const headers = Object.keys(filtered[0])
    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...filtered.map(row =>
        headers.map(h => escapeCsvCell(row[h])).join(','),
      ),
    ]
    const content = lines.join('\n')

    // Determine output path
    let dest = options.destination
    if (!dest || dest.endsWith('/')) {
      dest = join(dest || '.', defaultFilename('csv', filtered.length))
    }

    try {
      writeFileSync(dest, content, 'utf-8')
    } catch (err) {
      errors.push(`Write failed: ${(err as Error).message}`)
      return { success: false, recordsExported: 0, destination: dest, errors }
    }

    return { success: true, recordsExported: filtered.length, destination: dest }
  },
}

// ─── JSON Adapter ─────────────────────────────────────────────────────────────

export const jsonAdapter: ExportAdapter = {
  id: 'json',
  name: 'JSON Export',
  description: 'Export data as a JSON array of objects.',

  async export(data, options) {
    const filtered = selectFields(data, options.fields)
    const errors: string[] = []

    let dest = options.destination
    if (!dest || dest.endsWith('/')) {
      dest = join(dest || '.', defaultFilename('json', filtered.length))
    }

    const content = JSON.stringify(filtered, null, 2)

    try {
      writeFileSync(dest, content, 'utf-8')
    } catch (err) {
      errors.push(`Write failed: ${(err as Error).message}`)
      return { success: false, recordsExported: 0, destination: dest, errors }
    }

    return { success: true, recordsExported: filtered.length, destination: dest }
  },
}

// Re-export field selection helper for use by other adapters
export { selectFields, escapeCsvCell }
