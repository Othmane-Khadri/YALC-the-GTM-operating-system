import { describe, it, expect } from 'vitest'
import { cronToAgentSchedule, CronConversionError } from '../lib/frameworks/cron-conversion'

describe('cronToAgentSchedule', () => {
  it('maps daily at 08:00 ("0 8 * * *") to daily/hour=8/minute=0', () => {
    expect(cronToAgentSchedule('0 8 * * *')).toEqual({
      type: 'daily',
      hour: 8,
      minute: 0,
    })
  })

  it('maps Monday at 09:00 ("0 9 * * 1") to weekly/dayOfWeek=1', () => {
    expect(cronToAgentSchedule('0 9 * * 1')).toEqual({
      type: 'weekly',
      hour: 9,
      minute: 0,
      dayOfWeek: 1,
    })
  })

  it('maps every 4 hours ("0 */4 * * *") to interval/240 minutes', () => {
    expect(cronToAgentSchedule('0 */4 * * *')).toEqual({
      type: 'interval',
      intervalMinutes: 240,
    })
  })

  it('maps every 15 minutes ("*/15 * * * *") to interval/15 minutes', () => {
    expect(cronToAgentSchedule('*/15 * * * *')).toEqual({
      type: 'interval',
      intervalMinutes: 15,
    })
  })

  it('throws a clear error for weekday range ("0 8 * * 1-5") — runner has no list-of-days shape', () => {
    expect(() => cronToAgentSchedule('0 8 * * 1-5')).toThrow(CronConversionError)
    expect(() => cronToAgentSchedule('0 8 * * 1-5')).toThrow(/day-of-week/)
  })

  it('throws on garbage cron expressions', () => {
    expect(() => cronToAgentSchedule('not a cron')).toThrow(CronConversionError)
  })

  it('throws when month restriction is set ("0 8 * 6 *")', () => {
    expect(() => cronToAgentSchedule('0 8 * 6 *')).toThrow(/month/)
  })

  it('throws when day-of-month restriction is set ("0 8 1 * *")', () => {
    expect(() => cronToAgentSchedule('0 8 1 * *')).toThrow(/day-of-month/)
  })

  it('throws on a cron with non-5 fields', () => {
    expect(() => cronToAgentSchedule('0 8 * *')).toThrow(CronConversionError)
  })
})
