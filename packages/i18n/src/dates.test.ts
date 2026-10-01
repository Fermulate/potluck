import { describe, expect, it } from 'vitest'
import { formatDate, formatDateRange, formatRelative, formatTime } from './index'

const NY = 'America/New_York'
// 7:30 PM Friday June 12 in New York, already Saturday in Tokyo
const friday = '2026-06-12T23:30:00Z'

describe('formatDate', () => {
  it('formats in the given time zone', () => {
    expect(formatDate(friday, { timeZone: NY })).toBe('Jun 12, 2026')
    expect(formatDate(friday, { timeZone: 'Asia/Tokyo' })).toBe('Jun 13, 2026')
  })

  it('supports a few styles', () => {
    expect(formatDate(friday, { timeZone: NY, style: 'short' })).toBe('6/12/26')
    expect(formatDate(friday, { timeZone: NY, style: 'long' })).toBe('June 12, 2026')
    expect(formatDate(friday, { timeZone: NY, style: 'full' })).toBe('Friday, June 12, 2026')
    expect(formatDate(friday, { timeZone: NY, style: 'weekday' })).toBe('Fri, Jun 12')
    expect(formatDate(friday, { timeZone: NY, style: 'dayMonth' })).toBe('Jun 12')
  })

  it('treats YYYY-MM-DD as a calendar date, whatever the time zone', () => {
    expect(formatDate('2026-06-12', { timeZone: 'Pacific/Honolulu' })).toBe('Jun 12, 2026')
    expect(formatDate('2026-06-12', { timeZone: 'Asia/Tokyo' })).toBe('Jun 12, 2026')
  })

  it('accepts Date objects and epoch ms, and follows the locale', () => {
    expect(formatDate(new Date(friday), { timeZone: NY, locale: 'en-GB' })).toBe('12 Jun 2026')
    expect(formatDate(Date.parse(friday), { timeZone: NY, style: 'short' })).toBe('6/12/26')
  })
})

describe('formatTime', () => {
  it('formats the wall clock time in the given zone', () => {
    expect(formatTime(friday, { timeZone: NY })).toBe(`7:30 PM`)
    expect(formatTime(friday, { timeZone: 'Europe/Paris' })).toBe(`1:30 AM`)
  })

  it('uses a 24 hour clock where the locale does', () => {
    expect(formatTime(friday, { timeZone: NY, locale: 'en-GB' })).toBe('19:30')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-06-12T12:00:00Z')
  const rel = (iso: string, timeZone = 'UTC') => formatRelative(iso, { now, timeZone })

  it('says now for the last few seconds', () => {
    expect(rel('2026-06-12T11:59:50Z')).toBe('now')
  })

  it('counts minutes and hours, past and future', () => {
    expect(rel('2026-06-12T11:55:00Z')).toBe('5 minutes ago')
    expect(rel('2026-06-12T14:00:00Z')).toBe('in 2 hours')
    expect(rel('2026-06-12T01:00:00Z')).toBe('11 hours ago')
  })

  it('switches to calendar days after most of a day', () => {
    expect(rel('2026-06-11T09:00:00Z')).toBe('yesterday')
    expect(rel('2026-06-13T20:00:00Z')).toBe('tomorrow')
    expect(rel('2026-06-09T12:00:00Z')).toBe('3 days ago')
  })

  it('counts calendar days in the viewer time zone', () => {
    // 34 hours ago: still June 11 in UTC, but June 10 in New York
    expect(rel('2026-06-11T02:00:00Z')).toBe('yesterday')
    expect(rel('2026-06-11T02:00:00Z', NY)).toBe('2 days ago')
  })

  it('uses weeks, months, and years further out', () => {
    expect(rel('2026-05-29T12:00:00Z')).toBe('2 weeks ago')
    expect(rel('2026-04-10T12:00:00Z')).toBe('2 months ago')
    expect(rel('2025-05-01T12:00:00Z')).toBe('last year')
    expect(rel('2026-07-20T12:00:00Z')).toBe('next month')
  })

  it('compares calendar dates with the viewer day, without hours', () => {
    const la = 'America/Los_Angeles'
    // 6 PM June 12 in Los Angeles, already June 13 in UTC
    const evening = '2026-06-13T01:00:00Z'
    expect(formatRelative('2026-06-12', { now: evening, timeZone: la })).toBe('today')
    expect(formatRelative('2026-06-11', { now: evening, timeZone: la })).toBe('yesterday')
    expect(rel('2026-06-12')).toBe('today')
    expect(rel('2026-06-13')).toBe('tomorrow')
    expect(rel('2026-06-09')).toBe('3 days ago')
  })

  it('defaults now to the current time', () => {
    expect(formatRelative(new Date(), { timeZone: 'UTC' })).toBe('now')
  })
})

describe('formatDateRange', () => {
  it('collapses an evening into one day with a time range', () => {
    expect(formatDateRange('2026-06-12T23:00:00Z', '2026-06-13T01:00:00Z', { timeZone: NY })).toBe(
      `Fri, Jun 12, 7:00 - 9:00 PM`,
    )
  })

  it('shows both days when a time range crosses midnight', () => {
    expect(formatDateRange('2026-06-13T02:00:00Z', '2026-06-13T05:00:00Z', { timeZone: NY })).toBe(
      `Fri, Jun 12, 10:00 PM - Sat, Jun 13, 1:00 AM`,
    )
  })

  it('formats calendar date ranges without times', () => {
    expect(formatDateRange('2026-06-10', '2026-06-14', { timeZone: NY })).toBe('Jun 10 - 14, 2026')
    expect(formatDateRange('2026-06-28', '2026-07-03', { timeZone: NY })).toBe(
      'Jun 28 - Jul 3, 2026',
    )
    expect(formatDateRange('2026-06-10', '2026-06-10', { timeZone: NY })).toBe('Jun 10, 2026')
  })

  it('can drop the times from a timestamp range', () => {
    expect(
      formatDateRange('2026-06-12T23:00:00Z', '2026-06-14T01:00:00Z', {
        timeZone: NY,
        withTime: false,
      }),
    ).toBe('Jun 12 - 13, 2026')
  })
})
