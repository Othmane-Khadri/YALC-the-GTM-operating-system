// ─── Sequencer CSV Export Adapter ───────────────────────────────────────────
// Formats data specifically for email sequencer tool imports.
// Each tool has exact column requirements — malformed CSVs get rejected.

import { writeFileSync } from 'fs'
import { join } from 'path'
import type { ExportAdapter, ExportOptions, ExportResult } from '../types'
import { escapeCsvCell } from './csv'

// ─── Field mappings per sequencer ──────────────────────────────────────────

interface FieldMapping {
  /** Output column header (exact name the tool expects). */
  header: string
  /** Candidate source field names to look for in input data, in priority order. */
  sources: string[]
}

const LEMLIST_FIELDS: FieldMapping[] = [
  { header: 'first_name', sources: ['first_name', 'firstName', 'first'] },
  { header: 'last_name', sources: ['last_name', 'lastName', 'last'] },
  { header: 'email', sources: ['email', 'work_email', 'personal_email'] },
  { header: 'companyName', sources: ['companyName', 'company', 'organization', 'company_name'] },
  { header: 'linkedinUrl', sources: ['linkedinUrl', 'linkedin_url', 'linkedin', 'profile_url'] },
  { header: 'icebreaker', sources: ['icebreaker', 'snippet', 'personalization', 'hook'] },
]

const APOLLO_FIELDS: FieldMapping[] = [
  { header: 'first_name', sources: ['first_name', 'firstName', 'first'] },
  { header: 'last_name', sources: ['last_name', 'lastName', 'last'] },
  { header: 'email', sources: ['email', 'work_email', 'personal_email'] },
  { header: 'organization_name', sources: ['organization_name', 'company', 'companyName', 'company_name', 'organization'] },
  { header: 'title', sources: ['title', 'job_title', 'headline', 'position'] },
  { header: 'linkedin_url', sources: ['linkedin_url', 'linkedinUrl', 'linkedin', 'profile_url'] },
]

const WOODPECKER_FIELDS: FieldMapping[] = [
  { header: 'first_name', sources: ['first_name', 'firstName', 'first'] },
  { header: 'last_name', sources: ['last_name', 'lastName', 'last'] },
  { header: 'email', sources: ['email', 'work_email', 'personal_email'] },
  { header: 'company', sources: ['company', 'companyName', 'company_name', 'organization', 'organization_name'] },
  { header: 'website', sources: ['website', 'company_website', 'domain', 'url'] },
  { header: 'snippet', sources: ['snippet', 'icebreaker', 'personalization', 'hook'] },
]

const FORMAT_MAP: Record<string, FieldMapping[]> = {
  lemlist: LEMLIST_FIELDS,
  apollo: APOLLO_FIELDS,
  woodpecker: WOODPECKER_FIELDS,
}

/** Resolve a field value from a row using the priority source list. */
function resolveField(row: Record<string, unknown>, sources: string[]): string {
  for (const src of sources) {
    const val = row[src]
    if (val != null && val !== '') return String(val)
  }
  return ''
}

/** Map a single row to the sequencer's exact columns. */
function mapRow(row: Record<string, unknown>, fields: FieldMapping[]): string[] {
  return fields.map(f => resolveField(row, f.sources))
}

export const sequencerCsvAdapter: ExportAdapter = {
  id: 'sequencer-csv',
  name: 'Sequencer CSV Export',
  description: 'Export data formatted for email sequencer tools (Lemlist, Apollo, Woodpecker).',

  async export(data: Record<string, unknown>[], options: ExportOptions): Promise<ExportResult> {
    const format = (options.format || 'lemlist').toLowerCase()
    const fieldMapping = FORMAT_MAP[format]

    if (!fieldMapping) {
      return {
        success: false,
        recordsExported: 0,
        destination: '',
        errors: [`Unknown sequencer format: "${format}". Supported: ${Object.keys(FORMAT_MAP).join(', ')}`],
      }
    }

    if (data.length === 0) {
      return { success: true, recordsExported: 0, destination: '', errors: ['No data to export'] }
    }

    // Build CSV
    const headers = fieldMapping.map(f => f.header)
    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...data.map(row =>
        mapRow(row, fieldMapping).map(escapeCsvCell).join(','),
      ),
    ]
    const content = lines.join('\n')

    // Determine output path
    let dest = options.destination
    if (!dest || dest.endsWith('/')) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      dest = join(dest || '.', `${format}_export_${date}_${data.length}.csv`)
    }

    try {
      writeFileSync(dest, content, 'utf-8')
    } catch (err) {
      return {
        success: false,
        recordsExported: 0,
        destination: dest,
        errors: [`Write failed: ${(err as Error).message}`],
      }
    }

    return { success: true, recordsExported: data.length, destination: dest }
  },
}
