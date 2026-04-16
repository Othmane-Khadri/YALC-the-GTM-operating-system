import { describe, it, expect } from 'vitest'
import { isWithinSendWindow, shouldAutoActivate, parseSchedule, buildScheduleFromOptions, DEFAULT_SCHEDULE } from '../schedule'
import type { CampaignSchedule } from '../schedule'

describe('isWithinSendWindow', () => {
  const schedule: CampaignSchedule = {
    ...DEFAULT_SCHEDULE,
    timezone: 'UTC',
    sendWindow: { start: '09:00', end: '18:00' },
    activeDays: [1, 2, 3, 4, 5], // Mon-Fri
  }

  it('allows sending within window on active day', () => {
    // 2026-04-01 is a Wednesday (dayOfWeek=3), 12:00 UTC
    const wed = new Date('2026-04-01T12:00:00Z')
    const result = isWithinSendWindow(schedule, wed)
    expect(result.allowed).toBe(true)
  })

  it('blocks sending on weekend', () => {
    // 2026-04-05 is a Sunday
    const sun = new Date('2026-04-05T12:00:00Z')
    const result = isWithinSendWindow(schedule, sun)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('not an active day')
  })

  it('blocks sending outside time window', () => {
    // Wednesday at 06:00 UTC — before 09:00
    const early = new Date('2026-04-01T06:00:00Z')
    const result = isWithinSendWindow(schedule, early)
    expect(result.allowed).toBe(false)
  })
})

describe('shouldAutoActivate', () => {
  it('returns false when startAt is null', () => {
    const schedule: CampaignSchedule = { ...DEFAULT_SCHEDULE, timezone: 'UTC', startAt: null }
    expect(shouldAutoActivate(schedule)).toBe(false)
  })

  it('returns true when startAt date has passed', () => {
    const schedule: CampaignSchedule = { ...DEFAULT_SCHEDULE, timezone: 'UTC', startAt: '2020-01-01' }
    expect(shouldAutoActivate(schedule)).toBe(true)
  })
})

describe('parseSchedule', () => {
  it('returns null for falsy input', () => {
    expect(parseSchedule(null)).toBeNull()
    expect(parseSchedule(undefined)).toBeNull()
    expect(parseSchedule('')).toBeNull()
  })

  it('parses valid JSON string', () => {
    const schedule = parseSchedule(JSON.stringify(DEFAULT_SCHEDULE))
    expect(schedule).not.toBeNull()
    expect(schedule?.timezone).toBe('Europe/Paris')
  })

  it('returns null for empty object', () => {
    expect(parseSchedule({})).toBeNull()
  })
})

describe('buildScheduleFromOptions', () => {
  it('returns defaults when no options provided', () => {
    const schedule = buildScheduleFromOptions({})
    expect(schedule.timezone).toBe('Europe/Paris')
    expect(schedule.activeDays).toEqual([1, 2, 3, 4, 5])
  })

  it('overrides timezone and send window', () => {
    const schedule = buildScheduleFromOptions({ timezone: 'America/New_York', sendWindow: '10:00-16:00' })
    expect(schedule.timezone).toBe('America/New_York')
    expect(schedule.sendWindow).toEqual({ start: '10:00', end: '16:00' })
  })
})
