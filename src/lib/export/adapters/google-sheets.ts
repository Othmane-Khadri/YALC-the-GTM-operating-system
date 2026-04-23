// ─── Google Sheets Export Adapter ───────────────────────────────────────────
// Uses the Google Sheets REST API v4 directly (no googleapis SDK).
// Requires either GOOGLE_SHEETS_API_KEY (for public sheets) or a service
// account JSON credential for private sheets.

import type { ExportAdapter, ExportOptions, ExportResult } from '../types'
import { selectFields } from './csv'

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Resolve the access token — service account JSON or API key. */
async function resolveAuth(): Promise<{ token?: string; apiKey?: string }> {
  // Prefer service account if available
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (saJson) {
    try {
      const sa = JSON.parse(saJson)
      const token = await getServiceAccountToken(sa)
      return { token }
    } catch {
      // fall through to API key
    }
  }
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY
  if (apiKey) return { apiKey }
  throw new Error('Missing GOOGLE_SHEETS_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON env var')
}

/**
 * Minimal JWT-based service account token fetch.
 * Signs a JWT with the service account private key, exchanges for an access token.
 */
async function getServiceAccountToken(sa: {
  client_email: string
  private_key: string
  token_uri: string
}): Promise<string> {
  const { createSign } = await import('crypto')

  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url')

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const signature = sign.sign(sa.private_key, 'base64url')
  const jwt = `${header}.${payload}.${signature}`

  const resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`)
  const body = (await resp.json()) as { access_token: string }
  return body.access_token
}

export const googleSheetsAdapter: ExportAdapter = {
  id: 'google-sheets',
  name: 'Google Sheets Export',
  description: 'Push data to a Google Sheet via the Sheets API v4.',

  async export(data: Record<string, unknown>[], options: ExportOptions): Promise<ExportResult> {
    const filtered = selectFields(data, options.fields)
    const errors: string[] = []

    if (filtered.length === 0) {
      return { success: true, recordsExported: 0, destination: options.destination, errors: ['No data to export'] }
    }

    const spreadsheetId = options.destination
    if (!spreadsheetId) {
      return { success: false, recordsExported: 0, destination: '', errors: ['Spreadsheet ID required as destination'] }
    }

    const auth = await resolveAuth()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let urlSuffix = ''

    if (auth.token) {
      headers['Authorization'] = `Bearer ${auth.token}`
    } else if (auth.apiKey) {
      urlSuffix = `?key=${auth.apiKey}`
    }

    // Build the values array: [headers, ...rows]
    const fieldKeys = Object.keys(filtered[0])
    const values = [
      fieldKeys, // header row
      ...filtered.map(row => fieldKeys.map(k => {
        const v = row[k]
        return v == null ? '' : String(v)
      })),
    ]

    // Determine sheet name — use format option or default to 'Sheet1'
    const sheetName = options.format || 'Sheet1'
    const range = `${sheetName}!A1`

    // Clear existing data first, then write
    const clearUrl = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear${urlSuffix}`
    const clearResp = await fetch(clearUrl, { method: 'POST', headers })

    if (!clearResp.ok) {
      const msg = await clearResp.text()
      errors.push(`Clear failed (${clearResp.status}): ${msg}`)
      // Non-fatal — sheet may be new/empty
    }

    // Append data
    const updateUrl = `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW${auth.apiKey ? `&key=${auth.apiKey}` : ''}`
    const updateResp = await fetch(updateUrl, {
      method: 'PUT',
      headers: auth.token ? { ...headers } : headers,
      body: JSON.stringify({ range, majorDimension: 'ROWS', values }),
    })

    if (!updateResp.ok) {
      const msg = await updateResp.text()
      errors.push(`Update failed (${updateResp.status}): ${msg}`)
      return { success: false, recordsExported: 0, destination: spreadsheetId, errors }
    }

    return {
      success: true,
      recordsExported: filtered.length,
      destination: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }
  },
}
