// Personal calendar subscription: GET /functions/v1/ics-feed?token=...
// The token (from calendar_feed_token()) is the credential, so this function
// does not require a JWT. Returns scheduled events from the owner's groups.
import { adminClient } from '../_shared/admin.ts'

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.potluck-web.workers.dev'

function stamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (c) => `\\${c}`)
}

/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ' ' + rest.slice(74)
  }
  out.push(rest)
  return out.join('\r\n')
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token')
  if (!token || token.length < 32) return new Response('Not found', { status: 404 })

  const db = adminClient()
  const { data: owner } = await db
    .from('calendar_feed_tokens')
    .select('user_id')
    .eq('token', token)
    .maybeSingle()
  if (!owner) return new Response('Not found', { status: 404 })

  const { data: profile } = await db
    .from('profiles')
    .select('deleted_at')
    .eq('id', owner.user_id)
    .maybeSingle()
  if (!profile || profile.deleted_at) return new Response('Not found', { status: 404 })

  const { data: memberships } = await db
    .from('group_members')
    .select('group_id')
    .eq('user_id', owner.user_id)
  const groupIds = (memberships ?? []).map((m) => m.group_id)

  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString()
  const { data: events } = groupIds.length
    ? await db
        .from('events')
        .select(
          'id, title, description, location, starts_at, ends_at, status, updated_at, groups(name)',
        )
        .in('group_id', groupIds)
        .in('status', ['scheduled', 'done', 'cancelled'])
        .not('starts_at', 'is', null)
        .gte('starts_at', since)
    : { data: [] }

  const now = stamp(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Potluck//Plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Potluck',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]
  for (const e of events ?? []) {
    const group = (e.groups as { name?: string } | null)?.name
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@potluck`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${stamp(e.updated_at)}`,
      `DTSTART:${stamp(e.starts_at!)}`,
      `DTEND:${stamp(e.ends_at ?? e.starts_at!)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      `URL:${appUrl}/plans/${e.id}`,
    )
    const description = [e.description, group ? `Group: ${group}` : null].filter(Boolean).join('\n')
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
    },
  })
})
