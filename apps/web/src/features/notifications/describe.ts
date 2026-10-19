import type { NotificationRow } from '@potluck/api'
import { formatDate, formatMoney, formatRelative, formatTime, t } from '@potluck/i18n'

export type NotificationKind = 'money' | 'payment' | 'people' | 'plan' | 'comment' | 'other'

/** Where tapping a notification goes. Shaped for the router's `navigate`. */
export type NotificationTarget =
  | { to: '/expenses/$expenseId'; params: { expenseId: string } }
  | { to: '/plans/$eventId'; params: { eventId: string } }
  | { to: '/groups/$groupId'; params: { groupId: string } }
  | { to: '/groups/$groupId/balances'; params: { groupId: string } }
  | { to: '/groups/$groupId/members'; params: { groupId: string } }
  | { to: '/notifications'; params?: undefined }

export interface NotificationView {
  title: string
  body: string
  kind: NotificationKind
  target: NotificationTarget
}

export interface DescribeContext {
  /** Display names by profile id. */
  people: Map<string, string>
  /** Group names by id. */
  groups: Map<string, string>
  timeZone: string
  now?: Date
}

type Data = Record<string, unknown>

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function firstName(full: string | undefined): string | undefined {
  return full?.split(/\s+/)[0]
}

/** Turns a notification row into copy and a deep link. Unknown types fall back gracefully. */
export function describeNotification(n: NotificationRow, ctx: DescribeContext): NotificationView {
  const d = (n.data ?? {}) as Data
  const actor = firstName(ctx.people.get(str(d.actor_id) ?? '')) ?? t('notifications.someone')
  const groupId = str(d.group_id)
  const group = (groupId && ctx.groups.get(groupId)) || t('notifications.aGroup')
  const event = str(d.event_title) ?? t('notifications.anEvent')
  const description = str(d.description) ?? t('notifications.anExpense')
  const currency = str(d.currency) ?? 'USD'
  const amountCents = num(d.amount_cents)
  const amount = amountCents !== undefined ? formatMoney(amountCents, currency) : ''
  const expenseId = str(d.expense_id)
  const eventId = str(d.event_id)

  const toGroup = (suffix?: 'balances' | 'members'): NotificationTarget => {
    if (!groupId) return { to: '/notifications' }
    if (suffix === 'balances') return { to: '/groups/$groupId/balances', params: { groupId } }
    if (suffix === 'members') return { to: '/groups/$groupId/members', params: { groupId } }
    return { to: '/groups/$groupId', params: { groupId } }
  }
  const toExpense = (): NotificationTarget =>
    expenseId ? { to: '/expenses/$expenseId', params: { expenseId } } : toGroup()
  const toEvent = (): NotificationTarget =>
    eventId ? { to: '/plans/$eventId', params: { eventId } } : toGroup()

  switch (n.type) {
    case 'expense.created':
      return {
        title: t('notifications.types.expense.created.title', { group }),
        body: t('notifications.types.expense.created.body', { actor, description, amount }),
        kind: 'money',
        target: toExpense(),
      }
    case 'expense.updated':
      return {
        title: t('notifications.types.expense.updated.title'),
        body: t('notifications.types.expense.updated.body', { actor, description, group }),
        kind: 'money',
        target: toExpense(),
      }
    case 'settlement.created':
      return {
        title: t('notifications.types.settlement.created.title'),
        body: t('notifications.types.settlement.created.body', { actor, amount }),
        kind: 'payment',
        target: toGroup('balances'),
      }
    case 'member.joined':
      return {
        title: t('notifications.types.member.joined.title', { group }),
        body: t('notifications.types.member.joined.body', { actor }),
        kind: 'people',
        target: toGroup('members'),
      }
    case 'event.created':
      return {
        title: t('notifications.types.event.created.title'),
        body: t('notifications.types.event.created.body', { actor, event }),
        kind: 'plan',
        target: toEvent(),
      }
    case 'event.scheduled': {
      const startsAt = str(d.starts_at)
      const date = startsAt
        ? `${formatDate(startsAt, { timeZone: ctx.timeZone, style: 'weekday' })}, ${formatTime(startsAt, { timeZone: ctx.timeZone })}`
        : ''
      return {
        title: t('notifications.types.event.scheduled.title'),
        body: t('notifications.types.event.scheduled.body', { event, date }),
        kind: 'plan',
        target: toEvent(),
      }
    }
    case 'event.cancelled':
      return {
        title: t('notifications.types.event.cancelled.title'),
        body: t('notifications.types.event.cancelled.body', { event }),
        kind: 'plan',
        target: toEvent(),
      }
    case 'event.reminder': {
      const startsAt = str(d.starts_at)
      const when = startsAt
        ? formatRelative(startsAt, { timeZone: ctx.timeZone, now: ctx.now })
        : ''
      return {
        title: t('notifications.types.event.reminder.title'),
        body: t('notifications.types.event.reminder.body', { event, when }),
        kind: 'plan',
        target: toEvent(),
      }
    }
    case 'availability.requested':
      return {
        title: t('notifications.types.availability.requested.title'),
        body: t('notifications.types.availability.requested.body', { actor, event }),
        kind: 'plan',
        target: toEvent(),
      }
    case 'rsvp.reminder':
      return {
        title: t('notifications.types.rsvp.reminder.title'),
        body: t('notifications.types.rsvp.reminder.body', { group, event }),
        kind: 'plan',
        target: toEvent(),
      }
    case 'comment.created':
      return {
        title: t('notifications.types.comment.created.title'),
        body: t('notifications.types.comment.created.body', {
          actor,
          preview: str(d.excerpt) ?? str(d.body) ?? '',
        }),
        kind: 'comment',
        target: eventId ? toEvent() : toExpense(),
      }
    default:
      return {
        title: t('notifications.generic.title'),
        body: t('notifications.generic.body'),
        kind: 'other',
        target: groupId ? toGroup() : { to: '/notifications' },
      }
  }
}
