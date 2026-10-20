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

/** Fold lines longer than 75 octets (approximated by characters). */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  for (let i = 0; i < line.length; i += 74) parts.push((i ? ' ' : '') + line.slice(i, i + 74))
  return parts.join('\r\n')
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
