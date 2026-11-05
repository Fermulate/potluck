import { describe, expect, it } from 'vitest'
import { buildIcs, googleCalendarUrl } from './calendar'

const event = {
  id: 'abc',
  title: 'Tacos, gear swap; bring stuff',
  location: "Ben's backyard",
  description: 'Line one\nLine two',
  startsAt: '2026-06-12T01:00:00+00:00',
  endsAt: '2026-06-12T03:00:00+00:00',
  url: 'https://potluck.pages.dev/plans/abc',
}

describe('buildIcs', () => {
  it('writes a single UTC event with escaped text', () => {
    const ics = buildIcs(event, new Date('2026-06-01T00:00:00Z'))
    expect(ics).toContain('DTSTART:20260612T010000Z\r\n')
    expect(ics).toContain('DTEND:20260612T030000Z\r\n')
    expect(ics).toContain('SUMMARY:Tacos\\, gear swap\\; bring stuff\r\n')
    expect(ics).toContain('UID:abc@potluck')
    expect(ics).toContain(
      'DESCRIPTION:Line one\\nLine two\\n\\nhttps://potluck.pages.dev/plans/abc',
    )
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true)
  })
})

describe('googleCalendarUrl', () => {
  it('builds a template link', () => {
    const url = new URL(googleCalendarUrl(event))
    expect(url.searchParams.get('dates')).toBe('20260612T010000Z/20260612T030000Z')
    expect(url.searchParams.get('text')).toBe(event.title)
    expect(url.searchParams.get('location')).toBe(event.location)
  })
})
