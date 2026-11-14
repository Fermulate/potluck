// Push notification copy. No Deno APIs, so the tests run under Node too.
import { copyFor } from './copy.ts'

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  data: Record<string, string | number | boolean | null | undefined>
}

/** Fill `{name}` placeholders in a copy line. */
function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

/** An Intl locale for a profile locale: en-US for English, the bare language otherwise. */
function intl(locale: string | null | undefined): string {
  const base = (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en'
  return base === 'en' ? 'en-US' : base
}

/**
 * Minor units to a display string in an Intl locale, using the currency's own number of digits.
 * Never goes through a float: the amount is handed to Intl as a decimal string.
 */
export function formatMoneyIn(amountMinor: number, currency: string, locale: string): string {
  const code = currency.trim().toUpperCase()
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
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

const int = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

/**
 * What a new expense does to the recipient's balance, in its own currency: what they paid minus
 * their share, turned around for a refund (core `expenseEffect`). Positive means money back.
 */
export function recipientNet(n: NotificationRow): number {
  const d = n.data
  const share = int(d.share_cents)
  if (share === undefined) return 0
  const paid = int(d.paid_cents) ?? (d.paid_by === n.user_id ? (int(d.amount_cents) ?? 0) : 0)
  return (d.is_refund === true ? -1 : 1) * (paid - share)
}

/** A calendar date (`YYYY-MM-DD`) as "Thu, Jan 10". Calendar dates are the same everywhere. */
export function postingDay(day: string, locale?: string | null): string {
  const date = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return new Intl.DateTimeFormat(intl(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** An instant as "Wed, Jan 9, 7:10 PM" in `timeZone` (UTC when the zone is unknown). */
export function localMoment(iso: string, timeZone: string, locale?: string | null): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat(intl(locale), { ...options, timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat(intl(locale), { ...options, timeZone: 'UTC' }).format(date)
  }
}

/**
 * Push copy and the in-app path it opens, per notification type, in the recipient's language
 * (`profiles.locale`; English when missing or unknown).
 */
export function message(
  n: NotificationRow,
  locale?: string | null,
): { title: string; body: string; url: string } {
  const c = copyFor(locale)
  const d = n.data
  const group = d.group_id ? `/groups/${d.group_id}` : '/home'
  const expense = d.expense_id ? `/expenses/${d.expense_id}` : group
  const event = d.event_id ? `/plans/${d.event_id}` : '/plans'
  const payment = d.settlement_id ? `/payments/${d.settlement_id}` : `${group}/balances`
  const title = (fallback: string) => String(d.event_title ?? fallback)
  const refund = d.is_refund === true
  switch (n.type) {
    case 'expense.created': {
      const what = String(d.description ?? c.expenseNewBody)
      const net = recipientNet(n)
      const amount = formatMoneyIn(Math.abs(net), String(d.currency ?? 'USD'), intl(locale))
      return {
        title: refund ? c.refundNew : c.expenseNew,
        body:
          net < 0
            ? fill(c.youOwe, { what, amount })
            : net > 0
              ? fill(c.youGetBack, { what, amount })
              : what,
        url: expense,
      }
    }
    case 'expense.updated':
      return {
        title: refund ? c.refundUpdated : c.expenseUpdated,
        body: String(d.description ?? c.expenseUpdatedBody),
        url: expense,
      }
    case 'expense.deleted':
      return {
        title: refund ? c.refundDeleted : c.expenseDeleted,
        body: String(d.description ?? c.expenseDeletedBody),
        url: expense,
      }
    case 'expense.restored':
      return {
        title: refund ? c.refundRestored : c.expenseRestored,
        body: String(d.description ?? c.expenseRestoredBody),
        url: expense,
      }
    case 'group.deleted':
      return {
        title: String(d.group_name ?? c.groupDeleted),
        body: c.groupDeletedBody,
        url: d.deleted_group_id ? `/groups/${d.deleted_group_id}` : '/home',
      }
    case 'group.restored':
      return {
        title: String(d.group_name ?? c.groupRestored),
        body: c.groupRestoredBody,
        url: group,
      }
    case 'member.added':
      return {
        title: c.memberAdded,
        body: c.memberAddedBody,
        // Someone not on Potluck yet gets the claim link for their saved seat.
        url: d.claim_code ? `/join/${encodeURIComponent(String(d.claim_code))}` : group,
      }
    case 'member.invite_changed':
      return { title: c.inviteChanged, body: c.inviteChangedBody, url: `${group}/members` }
    case 'friend.added':
      return {
        title: c.friendAdded,
        body: c.friendAddedBody,
        url: d.user_id ? `/friends/${d.user_id}` : '/friends',
      }
    case 'settlement.created':
      return { title: c.payment, body: c.paymentBody, url: payment }
    case 'settlement.updated':
      return { title: c.paymentUpdated, body: c.paymentUpdatedBody, url: payment }
    case 'settlement.deleted':
      return { title: c.paymentDeleted, body: c.paymentDeletedBody, url: payment }
    case 'settlement.restored':
      return { title: c.paymentRestored, body: c.paymentRestoredBody, url: payment }
    case 'debt.reminder':
      return {
        title: c.nudge,
        // The note is the person's own words, shown as they wrote them.
        body: d.note ? String(d.note) : c.nudgeBody,
        // Straight to paying them back.
        url: d.group_id
          ? `/new/settle?groupId=${d.group_id}${d.from_user ? `&to=${d.from_user}` : ''}`
          : '/home',
      }
    case 'comment.created':
      return {
        title: c.comment,
        body: String(d.excerpt ?? c.commentBody),
        url: d.event_id ? event : d.settlement_id ? payment : expense,
      }
    case 'member.joined':
      return { title: c.member, body: c.memberBody, url: `${group}/members` }
    case 'availability.requested':
      return { title: c.availability, body: title(c.availabilityBody), url: event }
    case 'event.created':
      return { title: c.planNew, body: title(c.planNewBody), url: event }
    case 'event.scheduled':
      return { title: c.planOn, body: title(c.planOnBody), url: event }
    case 'event.cancelled':
      return { title: c.planCancelled, body: title(c.planCancelledBody), url: event }
    case 'event.reminder':
      return { title: c.reminder, body: title(c.reminderBody), url: event }
    case 'rsvp.reminder':
      return { title: c.rsvp, body: title(c.rsvpBody), url: event }
    case 'account.mfa_removed':
      return { title: c.mfaRemoved, body: c.mfaRemovedBody, url: '/me' }
    case 'recurring.upcoming': {
      const what = String(d.description ?? c.recurring)
      const by =
        typeof d.deadline === 'string'
          ? localMoment(d.deadline, typeof d.timezone === 'string' ? d.timezone : 'UTC', locale)
          : null
      return {
        title:
          typeof d.posts_on === 'string'
            ? fill(c.recurringOn, { what, date: postingDay(d.posts_on, locale) })
            : fill(c.recurringSoon, { what }),
        body: by ? fill(c.recurringBy, { deadline: by }) : c.recurringByBare,
        url: d.recurring_id ? `/recurring/${d.recurring_id}` : group,
      }
    }
    case 'recurring.paused':
      return {
        title: fill(c.recurringPaused, { what: String(d.description ?? c.recurring) }),
        body: c.recurringPausedBody,
        url: d.recurring_id ? `/recurring/${d.recurring_id}` : group,
      }
    default:
      return { title: 'Potluck', body: c.other, url: '/notifications' }
  }
}
