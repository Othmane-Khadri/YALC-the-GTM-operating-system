/**
 * Resolves the active archetype for /today entry.
 *
 * If the user has pinned an archetype in `~/.gtm-os/config.yaml`, /today
 * should bounce them to /dashboard/<archetype>. The lookup is best-effort
 * — any failure (network, schema mismatch, no pin) falls through to
 * /today.
 */

import { api, ApiError } from './api'

const VALID = new Set(['a', 'b', 'c', 'd'])

export async function resolveTodayRedirect(): Promise<string | null> {
  try {
    const body = await api.get<{ archetype?: string | null }>('/api/dashboard/active')
    const id = typeof body?.archetype === 'string' ? body.archetype.toLowerCase() : null
    if (id && VALID.has(id)) return `/dashboard/${id}`
    return null
  } catch (err) {
    // Auth or network errors mustn't break the SPA — fall back silently.
    if (err instanceof ApiError) return null
    return null
  }
}
