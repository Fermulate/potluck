export interface CalendarEvent {
  id: string
  title: string
  description?: string | null
  location?: string | null
  startsAt: string
  endsAt: string
  url?: string
}

/** 20260612T180000Z */
function icsStamp(value: string | Date): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Escape TEXT values per RFC 5545. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (c) => `\\${c}`)
}

const utf8Length = (ch: string) => {
  const cp = ch.codePointAt(0)!
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
}

/** Fold lines longer than 75 octets, breaking between code points (RFC 5545 section 3.1). */
function fold(line: string): string {
  const parts: string[] = []
  let current = ''
  let octets = 0
  for (const ch of line) {
    const size = utf8Length(ch)
    if (octets + size > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ''
      octets = 0
    }
    current += ch
    octets += size
  }
  parts.push(current)
  return parts.map((part, i) => (i ? ` ${part}` : part)).join('\r\n')
}

/** A single VEVENT calendar file. */
export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const description = [event.description, event.url].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Potluck//Plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@potluck`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(event.startsAt)}`,
    `DTEND:${icsStamp(event.endsAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${icsStamp(event.startsAt)}/${icsStamp(event.endsAt)}`,
  })
  const details = [event.description, event.url].filter(Boolean).join('\n\n')
  if (details) params.set('details', details)
  if (event.location) params.set('location', event.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Triggers a download of the .ics file. */
export function downloadIcs(event: CalendarEvent) {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `${
    event.title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'plan'
  }.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}
