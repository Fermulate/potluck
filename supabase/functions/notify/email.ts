// Notification email copy and markup. No Deno APIs, so the tests run under Node too.
// private.send_email_notifications builds each job: recipient, category, the
// notification data enriched with names, current amounts and unsubscribe tokens.
import { message } from './message.ts'

type Data = Record<string, unknown>

export interface EmailJob {
  id: string
  type: string
  category: string
  to: string
  name?: string | null
  timezone?: string | null
  unsubscribe: string
  unsubscribe_all: string
  data: Data
}

export interface EmailLinks {
  /** The web app, e.g. https://potluck.fermulate.com */
  appUrl: string
  /** Where mail clients POST a one-click unsubscribe (RFC 8058). */
  oneClickUrl: string
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

/** What each setting is called in the footer ("You get these because ... is on"). */
export const CATEGORY_LABELS: Record<string, string> = {
  expense_added: 'new expenses',
  expense_changed: 'expense edits and deletions',
  payments: 'payments',
  comments: 'comments',
  groups: 'group updates',
  plans: 'plans',
  reminders: 'reminders',
  monthly_summary: 'the monthly summary',
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

/** Minor units to a display string, using the currency's own number of digits. */
export function formatMoney(amountMinor: number, currency: string): string {
  const code = currency.trim().toUpperCase()
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
  } catch {
    return `${amountMinor} ${code}`
  }
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  const negative = amountMinor < 0
  const abs = Math.abs(amountMinor)
    .toString()
    .padStart(digits + 1, '0')
  const whole = digits > 0 ? abs.slice(0, -digits) : abs
  const frac = digits > 0 ? `.${abs.slice(-digits)}` : ''
  // A decimal string keeps exact digits; Intl accepts it in Node 22 and Deno 2.
  return format.format(`${negative ? '-' : ''}${whole}${frac}` as unknown as number)
}

function formatWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toUTCString()
  }
}

function monthName(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'last month'
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Copy {
  subject: string
  /** Short heading in the email body. */
  heading: string
  /** Paragraphs under the heading. */
  lines: string[]
  /** Optional list (the monthly summary). */
  rows?: { label: string; value: string }[]
  cta: string
}

interface SummaryGroup {
  name?: unknown
  currency?: unknown
  net_cents?: unknown
  expenses?: unknown
  payments?: unknown
}

function copyFor(job: EmailJob): Copy {
  const d = job.data
  const actor = str(d.actor_name) ?? 'Someone'
  const group = str(d.group_name)
  const inGroup = group ? ` in ${group}` : ''
  const description = str(d.description) ?? 'an expense'
  const currency = str(d.currency) ?? 'USD'
  const amountCents = num(d.amount_cents)
  const amount = amountCents !== undefined ? formatMoney(amountCents, currency) : undefined
  const shareCents = num(d.share_cents)
  const share = shareCents && shareCents > 0 ? formatMoney(shareCents, currency) : undefined
  const event = str(d.event_title) ?? 'a plan'
  const zone = str(job.timezone) ?? 'UTC'
  const startsAt = str(d.starts_at)

  switch (job.type) {
    case 'expense.created':
      return {
        subject: `${actor} added "${description}"${inGroup}`,
        heading: `${actor} added "${description}"${inGroup}.`,
        lines: [amount ? `Total: ${amount}.` : '', share ? `Your share: ${share}.` : ''].filter(
          Boolean,
        ),
        cta: 'See the expense',
      }
    case 'expense.updated':
      return {
        subject: `${actor} changed "${description}"${inGroup}`,
        heading: `${actor} changed "${description}"${inGroup}.`,
        lines: [
          amount ? `It now comes to ${amount}.` : '',
          share ? `Your share: ${share}.` : '',
        ].filter(Boolean),
        cta: 'See what changed',
      }
    case 'expense.deleted':
      return {
        subject: `${actor} deleted "${description}"${inGroup}`,
        heading: `${actor} deleted "${description}"${inGroup}.`,
        lines: [
          `It no longer counts toward anyone's balance${amount ? ` (it was ${amount})` : ''}. It can be restored from the expense page.`,
        ],
        cta: 'Open the expense',
      }
    case 'expense.restored':
      return {
        subject: `${actor} restored "${description}"${inGroup}`,
        heading: `${actor} restored "${description}"${inGroup}.`,
        lines: [
          `It counts toward balances again${amount ? `: ${amount}` : ''}.`,
          share ? `Your share: ${share}.` : '',
        ].filter(Boolean),
        cta: 'See the expense',
      }
    case 'settlement.created':
      return {
        subject: `${actor} recorded a payment${inGroup}`,
        heading: `${actor} recorded a payment${amount ? ` of ${amount}` : ''}${inGroup}.`,
        lines: ['Your balances are up to date.'],
        cta: 'See balances',
      }
    case 'comment.created':
      return {
        subject: `${actor} left a comment${inGroup}`,
        heading: `${actor} left a comment${inGroup}:`,
        lines: [`"${str(d.excerpt) ?? '...'}"`],
        cta: 'Reply',
      }
    case 'member.added':
      return {
        subject: `${actor} added you to ${group ?? 'a group'}`,
        heading: `${actor} added you to ${group ?? 'a group'}.`,
        lines: ['Expenses and plans in the group now include you. Pull up a chair.'],
        cta: 'Open the group',
      }
    case 'member.joined':
      return {
        subject: `Someone new joined ${group ?? 'your group'}`,
        heading: `Someone new joined ${group ?? 'your group'}.`,
        lines: ['Say hi when you get a moment.'],
        cta: 'See members',
      }
    case 'event.created':
      return {
        subject: `${actor} is planning ${event}`,
        heading: `${actor} is planning ${event}${inGroup}.`,
        lines: ['Add when you are free so the group can pick a time.'],
        cta: 'Open the plan',
      }
    case 'event.scheduled':
      return {
        subject: `It's a date: ${event}`,
        heading: `${event} is on.`,
        lines: [startsAt ? `${formatWhen(startsAt, zone)}.` : 'The time is set.'],
        cta: 'Open the plan',
      }
    case 'event.cancelled':
      return {
        subject: `${event} was called off`,
        heading: `${event} was called off.`,
        lines: ['Plans change. There will be another one.'],
        cta: 'Open the plan',
      }
    case 'availability.requested':
      return {
        subject: `When are you free for ${event}?`,
        heading: `${actor} needs your availability for ${event}.`,
        lines: ['Paint the times that work and the group will find the best slot.'],
        cta: 'Add my times',
      }
    case 'event.reminder':
      return {
        subject: `Coming up: ${event}`,
        heading: `${event} is coming up.`,
        lines: [startsAt ? `${formatWhen(startsAt, zone)}.` : 'It starts soon.'],
        cta: 'Open the plan',
      }
    case 'rsvp.reminder':
      return {
        subject: `Are you in for ${event}?`,
        heading: `Let ${group ?? 'the group'} know if you are coming to ${event}.`,
        lines: startsAt ? [`${formatWhen(startsAt, zone)}.`] : [],
        cta: 'Answer',
      }
    case 'summary.monthly': {
      const groups = Array.isArray(d.groups) ? (d.groups as SummaryGroup[]) : []
      const rows = groups.map((g) => {
        const net = num(g.net_cents) ?? 0
        const money = formatMoney(Math.abs(net), str(g.currency) ?? 'USD')
        const value =
          net > 0 ? `you are owed ${money}` : net < 0 ? `you owe ${money}` : 'all settled up'
        return { label: str(g.name) ?? 'A group', value }
      })
      const month = monthName(str(d.month) ?? '')
      const expenses = groups.reduce((sum, g) => sum + (num(g.expenses) ?? 0), 0)
      const payments = groups.reduce((sum, g) => sum + (num(g.payments) ?? 0), 0)
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
      return {
        subject: `Your Potluck ${month}`,
        heading: `Here is where things stand after ${month}.`,
        lines: [
          `${plural(expenses, 'new expense', 'new expenses')} and ${plural(payments, 'payment', 'payments')} involved you.`,
        ],
        rows,
        cta: 'Open Potluck',
      }
    }
    default:
      return {
        subject: 'Something new in Potluck',
        heading: 'Something new is waiting for you.',
        lines: [],
        cta: 'Open Potluck',
      }
  }
}

function linkPath(job: EmailJob): string {
  if (job.type === 'summary.monthly') return '/home'
  return message({ id: job.id, user_id: '', type: job.type, data: job.data as never }).url
}

/** Subject, plain text, HTML and the one-click unsubscribe headers for one job. */
export function renderEmail(job: EmailJob, links: EmailLinks): RenderedEmail {
  const copy = copyFor(job)
  const app = links.appUrl.replace(/\/$/, '')
  const open = `${app}${linkPath(job)}`
  const settings = `${app}/me`
  const unsubscribe = `${app}/unsubscribe?token=${encodeURIComponent(job.unsubscribe)}`
  const unsubscribeAll = `${app}/unsubscribe?token=${encodeURIComponent(job.unsubscribe_all)}`
  const oneClick = `${links.oneClickUrl}?token=${encodeURIComponent(job.unsubscribe)}`
  const what = CATEGORY_LABELS[job.category] ?? 'these emails'
  const greeting = str(job.name) ? `Hi ${str(job.name)!.split(/\s+/)[0]},` : 'Hi,'

  const text = [
    greeting,
    '',
    copy.heading,
    ...copy.lines,
    ...(copy.rows ?? []).map((r) => `  ${r.label}: ${r.value}`),
    '',
    `${copy.cta}: ${open}`,
    '',
    '--',
    `You get these because emails about ${what} are on.`,
    `Stop emails about ${what}: ${unsubscribe}`,
    `Stop all Potluck email: ${unsubscribeAll}`,
    `All notification settings: ${settings}`,
  ].join('\n')

  const e = escapeHtml
  const rows = (copy.rows ?? [])
    .map(
      (r) =>
        `<tr><td class="rule" style="padding:8px 0;border-top:1px solid #ebe2d3;font-weight:600">${e(r.label)}</td><td class="rule" style="padding:8px 0;border-top:1px solid #ebe2d3;text-align:right;font-variant-numeric:tabular-nums">${e(r.value)}</td></tr>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(copy.subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  body, .paper { background: #14110e !important; }
  .card { background: #1f1b17 !important; border-color: #3a332b !important; }
  .rule { border-color: #3a332b !important; }
  .ink { color: #f6efe3 !important; }
  .mute { color: #b5ab9c !important; }
}
</style>
</head>
<body class="paper" style="margin:0;padding:0;background:#fbf5ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="paper" style="background:#fbf5ea">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td class="ink" style="padding:0 4px 16px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;color:#1d1a16">Potluck</td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #ebe2d3;border-radius:18px;padding:28px 24px">
<p class="mute" style="margin:0 0 12px;font-size:15px;color:#716759">${e(greeting)}</p>
<h1 class="ink" style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#1d1a16">${e(copy.heading)}</h1>
${copy.lines.map((l) => `<p class="ink" style="margin:0 0 10px;font-size:16px;line-height:1.5;color:#1d1a16">${e(l)}</p>`).join('\n')}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ink" style="margin:8px 0 4px;font-size:15px;color:#1d1a16">${rows}</table>` : ''}
<p style="margin:22px 0 0"><a href="${e(open)}" style="display:inline-block;background:#e8492f;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 22px;border-radius:999px">${e(copy.cta)}</a></p>
</td></tr>
<tr><td class="mute" style="padding:18px 4px 0;font-size:13px;line-height:1.6;color:#716759">
You get these because emails about ${e(what)} are on.<br>
<a href="${e(unsubscribe)}" class="mute" style="color:#716759">Stop emails about ${e(what)}</a> &middot;
<a href="${e(unsubscribeAll)}" class="mute" style="color:#716759">Stop all Potluck email</a> &middot;
<a href="${e(settings)}" class="mute" style="color:#716759">Notification settings</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return {
    subject: copy.subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${oneClick}>, <${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}
