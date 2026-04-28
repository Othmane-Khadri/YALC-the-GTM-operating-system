/**
 * Convert a 5-field cron expression into the AgentSchedule shape that the
 * BackgroundAgent runner consumes. The runner only understands four
 * schedule shapes — `daily`, `weekly`, `interval`, and `cron` — but the
 * `cron` shape is currently a no-op in the runtime, so we eagerly map
 * known patterns to `daily` / `weekly` / `interval` so launchd actually
 * fires them.
 *
 * Conversion rules:
 *   - `M H * * *`              → daily at H:M
 *   - `M H * * D`              → weekly on day-of-week D (single value) at H:M
 *   - `M H * * D1-D2`          → daily at H:M (Mon-Fri etc.) — not encodable
 *                                in the current AgentSchedule, so we throw
 *                                with a clear message
 *   - `0 *\/N * * *` or similar→ interval N hours (when minute is 0)
 *   - `*\/N * * * *`           → interval N minutes
 *
 * The mapping is intentionally narrow: anything we can't faithfully
 * encode throws so the user gets a clear install-time error instead of
 * a silent fall-back to "daily at 08:00".
 */

import { CronExpressionParser } from 'cron-parser'
import type { AgentSchedule } from '../agents/types.js'

export class CronConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronConversionError'
  }
}

/** Pull raw field strings out of a 5-field cron expression. */
function splitFiveFields(cron: string): {
  minute: string
  hour: string
  dom: string
  month: string
  dow: string
} {
  const trimmed = cron.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length !== 5) {
    throw new CronConversionError(
      `Cron must have 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}: "${cron}"`,
    )
  }
  return { minute: parts[0], hour: parts[1], dom: parts[2], month: parts[3], dow: parts[4] }
}

/** Validate a cron string by handing it to cron-parser. */
function ensureParseable(cron: string): void {
  try {
    CronExpressionParser.parse(cron)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CronConversionError(`Cron expression "${cron}" is not parseable: ${msg}`)
  }
}

const STEP_MINUTE = /^\*\/(\d+)$/
const SINGLE_NUMBER = /^(\d+)$/

/**
 * Convert a 5-field cron expression to the agent schedule shape, or
 * throw `CronConversionError` if it can't be encoded. The thrown
 * message tells the user *why* and is safe to surface verbatim at
 * install time.
 */
export function cronToAgentSchedule(cron: string): AgentSchedule {
  const fields = splitFiveFields(cron)
  ensureParseable(cron)

  const { minute, hour, dom, month, dow } = fields

  // `* * * * *` (every minute) maps to interval 1.
  if (
    STEP_MINUTE.test(minute) &&
    hour === '*' &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    const n = Number(minute.match(STEP_MINUTE)![1])
    if (n < 1 || n > 59) {
      throw new CronConversionError(`Step value out of range: "${minute}"`)
    }
    return { type: 'interval', intervalMinutes: n }
  }

  // `0 */N * * *` → interval every N hours.
  if (
    minute === '0' &&
    STEP_MINUTE.test(hour) &&
    dom === '*' &&
    month === '*' &&
    dow === '*'
  ) {
    const n = Number(hour.match(STEP_MINUTE)![1])
    if (n < 1 || n > 23) {
      throw new CronConversionError(`Step value out of range: "${hour}"`)
    }
    return { type: 'interval', intervalMinutes: n * 60 }
  }

  if (month !== '*') {
    throw new CronConversionError(
      `Cron month restriction "${month}" cannot be encoded by the agent runner — use "*"`,
    )
  }

  if (dom !== '*') {
    throw new CronConversionError(
      `Cron day-of-month restriction "${dom}" cannot be encoded by the agent runner — use "*"`,
    )
  }

  // Single minute + single hour required for daily/weekly mapping.
  if (!SINGLE_NUMBER.test(minute) || !SINGLE_NUMBER.test(hour)) {
    throw new CronConversionError(
      `Cron expression "${cron}" needs a single minute and a single hour to map to the agent schedule. Use a step expression (e.g. "*/15 * * * *") or set both to single values.`,
    )
  }
  const m = Number(minute)
  const h = Number(hour)
  if (m < 0 || m > 59) throw new CronConversionError(`Minute out of range: ${m}`)
  if (h < 0 || h > 23) throw new CronConversionError(`Hour out of range: ${h}`)

  // `M H * * *` → daily at H:M.
  if (dow === '*') {
    return { type: 'daily', hour: h, minute: m }
  }

  // `M H * * D` (single dow) → weekly.
  if (SINGLE_NUMBER.test(dow)) {
    const d = Number(dow)
    if (d < 0 || d > 6) throw new CronConversionError(`Day-of-week out of range: ${d}`)
    return { type: 'weekly', hour: h, minute: m, dayOfWeek: d }
  }

  // `M H * * D1-D2` (range) — runner has no list-of-days shape.
  // BackgroundAgent currently ignores this anyway, but we want a loud
  // error at install so the user picks a different cron rather than
  // discover silent skips at runtime.
  throw new CronConversionError(
    `Cron day-of-week "${dow}" requires a list/range that the agent runner cannot encode. Use a single weekday (0-6) or "*", or split into multiple installed frameworks.`,
  )
}
