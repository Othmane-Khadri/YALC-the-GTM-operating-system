// ─── CSV/JSON Export Utility ─────────────────────────────────────────────────

import { writeFileSync } from 'fs'

const DEFAULT_CSV_FIELDS = [
  'first_name',
  'last_name',
  'headline',
  'company',
  'linkedin_url',
  'engagement_type',
  'source',
]

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function exportToCsv(
  data: Record<string, unknown>[],
  outputPath: string,
  fields: string[] = DEFAULT_CSV_FIELDS,
): void {
  const header = fields.join(',')
  const rows = data.map((row) =>
    fields.map((f) => escapeCsvField(String(row[f] ?? ''))).join(','),
  )
  writeFileSync(outputPath, [header, ...rows].join('\n'))
}

export function exportToJson(
  data: Record<string, unknown>[],
  outputPath: string,
): void {
  writeFileSync(outputPath, JSON.stringify(data, null, 2))
}

export function exportData(
  data: Record<string, unknown>[],
  outputDir: string,
  baseName: string,
  format: 'json' | 'csv' | 'both',
): string[] {
  const paths: string[] = []

  if (format === 'json' || format === 'both') {
    const jsonPath = `${outputDir}/${baseName}.json`
    exportToJson(data, jsonPath)
    paths.push(jsonPath)
  }

  if (format === 'csv' || format === 'both') {
    const csvPath = `${outputDir}/${baseName}.csv`
    exportToCsv(data, csvPath)
    paths.push(csvPath)
  }

  return paths
}
