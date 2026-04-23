// ─── Webhook Export Adapter ─────────────────────────────────────────────────
// HTTP POST to any URL with retry on 429/5xx.
// Supports batch mode (all records in one request) and stream mode (one per request).

import type { ExportAdapter, ExportOptions, ExportResult } from '../types'
import { selectFields } from './csv'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Parse custom headers from format option. Expected: JSON string of key-value pairs. */
function parseHeaders(format?: string): Record<string, string> {
  if (!format) return {}
  try {
    return JSON.parse(format) as Record<string, string>
  } catch {
    return {}
  }
}

/** Determine if we should retry based on status code. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/** Send a single POST with exponential backoff retry. */
async function postWithRetry(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
  let lastStatus = 0
  let lastBody = ''

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      await sleep(delay)
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })

      lastStatus = resp.status
      lastBody = await resp.text()

      if (resp.ok) {
        return { ok: true, status: resp.status, body: lastBody }
      }

      if (!isRetryable(resp.status)) {
        return { ok: false, status: resp.status, body: lastBody }
      }
      // Retryable — loop continues
    } catch (err) {
      lastStatus = 0
      lastBody = (err as Error).message
      // Network error — retry
    }
  }

  return { ok: false, status: lastStatus, body: lastBody }
}

export const webhookAdapter: ExportAdapter = {
  id: 'webhook',
  name: 'Webhook Export',
  description: 'HTTP POST data to any URL. Supports batch and stream modes with retry on 429/5xx.',

  async export(data: Record<string, unknown>[], options: ExportOptions): Promise<ExportResult> {
    const filtered = selectFields(data, options.fields)
    const errors: string[] = []

    if (!options.destination) {
      return { success: false, recordsExported: 0, destination: '', errors: ['Webhook URL required as destination'] }
    }

    const url = options.destination
    const customHeaders = parseHeaders(options.format)

    // Determine mode: if format contains "stream" key, use stream mode
    const isStream = options.format?.includes('"mode":"stream"') ?? false

    if (isStream) {
      // Stream mode: one request per record
      let exported = 0

      for (let i = 0; i < filtered.length; i++) {
        const result = await postWithRetry(url, filtered[i], customHeaders)
        if (result.ok) {
          exported++
        } else {
          errors.push(`Row ${i}: HTTP ${result.status} — ${result.body.slice(0, 200)}`)
        }
      }

      return {
        success: errors.length === 0,
        recordsExported: exported,
        destination: url,
        errors: errors.length > 0 ? errors : undefined,
      }
    } else {
      // Batch mode: all records in one request
      const result = await postWithRetry(url, { records: filtered, count: filtered.length }, customHeaders)

      if (result.ok) {
        return { success: true, recordsExported: filtered.length, destination: url }
      }

      errors.push(`HTTP ${result.status} — ${result.body.slice(0, 500)}`)
      return { success: false, recordsExported: 0, destination: url, errors }
    }
  },
}
