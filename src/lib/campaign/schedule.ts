/**
 * Campaign scheduling utilities — timezone-aware send windows, business-day delays, pace control.
 * Uses Intl.DateTimeFormat (no external deps).
 */

export interface CampaignSchedule {
  timezone: string               // IANA timezone e.g. "Europe/Paris"
  startAt: string | null         // ISO date e.g. "2026-04-03" — null = immediate
  sendWindow: {
    start: string                // HH:mm e.g. "09:00"
    end: string                  // HH:mm e.g. "18:00"
  }
  activeDays: number[]           // 1=Monday ... 7=Sunday
  sendingPace: {
    secondsBetweenSends: number  // min delay between individual sends (default: 180)
  }
  delayMode: 'business' | 'calendar'
}

export const DEFAULT_SCHEDULE: CampaignSchedule = {
  timezone: 'Europe/Paris',
  startAt: null,
  sendWindow: { start: '09:00', end: '18:00' },
  activeDays: [1, 2, 3, 4, 5],
  sendingPace: { secondsBetweenSends: 180 },
  delayMode: 'business',
}

/**
 * Parse a schedule from the DB JSON column. Returns null for legacy campaigns with no schedule.
 */
export function parseSchedule(raw: unknown): CampaignSchedule | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return null
      return parsed as CampaignSchedule
    } catch {
      return null
    }
  }
  if (typeof raw === 'object' && Object.keys(raw as object).length === 0) return null
  return raw as CampaignSchedule
}

/**
 * Get current time parts in a specific IANA timezone.
 */
export function getNowInTimezone(timezone: string, now?: Date): { hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  const d = now ?? new Date()

  // Get the time string in the target timezone
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d)

  const hours = parseInt(timeParts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const minutes = parseInt(timeParts.find(p => p.type === 'minute')?.value ?? '0', 10)

  // Get the day of week (1=Monday...7=Sunday) in the target timezone
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const weekdayStr = dateParts.find(p => p.type === 'weekday')?.value ?? 'Mon'
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const dayOfWeek = dayMap[weekdayStr] ?? 1

  const year = dateParts.find(p => p.type === 'year')?.value ?? '2026'
  const month = dateParts.find(p => p.type === 'month')?.value ?? '01'
  const day = dateParts.find(p => p.type === 'day')?.value ?? '01'
  const dateStr = `${year}-${month}-${day}`

  return { hours, minutes, dayOfWeek, dateStr }
}

/**
 * Gate A: Check if a scheduled campaign should auto-activate.
 * Returns true if startAt date has passed (in the campaign's timezone).
 */
export function shouldAutoActivate(schedule: CampaignSchedule, now?: Date): boolean {
  if (!schedule.startAt) return false
  const { dateStr } = getNowInTimezone(schedule.timezone, now)
  return dateStr >= schedule.startAt
}

/**
 * Gate B: Check if current time is within the campaign's send window.
 * Returns { allowed, reason } where reason explains why sending is blocked.
 */
export function isWithinSendWindow(schedule: CampaignSchedule, now?: Date): { allowed: boolean; reason: string } {
  const tz = getNowInTimezone(schedule.timezone, now)

  // Check active day
  if (!schedule.activeDays.includes(tz.dayOfWeek)) {
    const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const activeDayNames = schedule.activeDays.map(d => dayNames[d]).join(',')
    return {
      allowed: false,
      reason: `${dayNames[tz.dayOfWeek]} is not an active day (active: ${activeDayNames})`,
    }
  }

  // Check time window
  const nowMinutes = tz.hours * 60 + tz.minutes
  const [startH, startM] = schedule.sendWindow.start.split(':').map(Number)
  const [endH, endM] = schedule.sendWindow.end.split(':').map(Number)
  const windowStart = startH * 60 + startM
  const windowEnd = endH * 60 + endM

  if (nowMinutes < windowStart || nowMinutes >= windowEnd) {
    const pad = (n: number) => String(n).padStart(2, '0')
    const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return {
      allowed: false,
      reason: `current: ${dayNames[tz.dayOfWeek]} ${pad(tz.hours)}:${pad(tz.minutes)} ${schedule.timezone}, window: ${schedule.sendWindow.start}-${schedule.sendWindow.end}`,
    }
  }

  return { allowed: true, reason: '' }
}

/**
 * Gate D: Business-day-aware version of isDaysAgo.
 * When delayMode is "business", counts only days in activeDays.
 * When delayMode is "calendar" (or no schedule), counts all days.
 */
export function isBusinessDaysAgo(
  dateStr: string | null,
  days: number,
  schedule: CampaignSchedule | null,
): boolean {
  if (!dateStr) return false

  // No schedule or calendar mode → fall back to simple calendar-day check
  if (!schedule || schedule.delayMode === 'calendar') {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    return diffMs >= days * 24 * 60 * 60 * 1000
  }

  // Business-day mode: walk forward from the date, counting only active days
  const activeDays = schedule.activeDays
  if (activeDays.length === 0) return false // never send

  const start = new Date(dateStr)
  let businessDaysCounted = 0
  const cursor = new Date(start)

  // Step one calendar day at a time from the event date
  while (businessDaysCounted < days) {
    cursor.setDate(cursor.getDate() + 1)
    // Get day-of-week in the campaign timezone
    const { dayOfWeek } = getNowInTimezone(schedule.timezone, cursor)
    if (activeDays.includes(dayOfWeek)) {
      businessDaysCounted++
    }
  }

  // The earliest send time is the cursor date — check if we've reached it
  return Date.now() >= cursor.getTime()
}

/**
 * Build a CampaignSchedule from CLI options, filling in defaults.
 */
export function buildScheduleFromOptions(opts: {
  timezone?: string
  startAt?: string
  sendWindow?: string       // "HH:mm-HH:mm"
  activeDays?: string       // "1,2,3,4,5"
  delayMode?: string
  secondsBetweenSends?: number
}): CampaignSchedule {
  const schedule = { ...DEFAULT_SCHEDULE }

  if (opts.timezone) schedule.timezone = opts.timezone
  if (opts.startAt) schedule.startAt = opts.startAt
  if (opts.sendWindow) {
    const [start, end] = opts.sendWindow.split('-')
    if (start && end) {
      schedule.sendWindow = { start: start.trim(), end: end.trim() }
    }
  }
  if (opts.activeDays) {
    schedule.activeDays = opts.activeDays.split(',').map(d => parseInt(d.trim(), 10)).filter(d => d >= 1 && d <= 7)
  }
  if (opts.delayMode === 'business' || opts.delayMode === 'calendar') {
    schedule.delayMode = opts.delayMode
  }
  if (opts.secondsBetweenSends != null) {
    schedule.sendingPace = { secondsBetweenSends: opts.secondsBetweenSends }
  }

  return schedule
}
