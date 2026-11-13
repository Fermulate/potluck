import { firstName } from '@potluck/core'
import type { NotificationRow } from '@potluck/api'
import { formatDate, formatMoney, formatRelative, formatTime, t } from '@potluck/i18n'

export type NotificationKind =
  'money' | 'payment' | 'people' | 'plan' | 'comment' | 'summary' | 'other'

/** Where tapping a notification goes. Shaped for the router's `navigate`. */
export type NotificationTarget =
  | { to: '/expenses/$expenseId'; params: { expenseId: string } }
  | { to: '/plans/$eventId'; params: { eventId: string } }
  | { to: '/groups/$groupId'; params: { groupId: string } }
  | { to: '/groups/$groupId/balances'; params: { groupId: string } }
  | { to: '/groups/$groupId/members'; params: { groupId: string } }
  | { to: '/notifications'; params?: undefined }
  | { to: '/home'; params?: undefined }
  | { to: '/me'; params?: undefined }

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

const firstNameOf = (full: string | undefined) => (full ? firstName(full) : undefined)

/** "Roommates: you are owed $12.50, Hike crew: you owe $5.00 and 1 more group". */
function summaryLine(groups: unknown, ctx: DescribeContext): string {
  const owing = (Array.isArray(groups) ? groups : [])
    .map((g) => (g ?? {}) as Data)
    .filter((g) => (num(g.net_cents) ?? 0) !== 0)
  if (owing.length === 0) return t('notifications.types.summary.monthly.settled')
  const parts = owing.slice(0, 2).map((g) => {
    const net = num(g.net_cents)!
    const groupId = str(g.group_id)
    const group = (groupId && ctx.groups.get(groupId)) || str(g.name) || t('notifications.aGroup')
    const amount = formatMoney(Math.abs(net), str(g.currency) ?? 'USD')
    return net > 0
      ? t('notifications.types.summary.owed', { group, amount })
      : t('notifications.types.summary.owe', { group, amount })
  })
  const line = parts.join(', ')
  const more = owing.length - parts.length
  return more > 0 ? `${line} ${t('notifications.types.summary.more', { count: more })}` : line
}

/** Turns a notification row into copy and a deep link. Unknown types fall back gracefully. */
export function describeNotification(n: NotificationRow, ctx: DescribeContext): NotificationView {
  const d = (n.data ?? {}) as Data
  const actor = firstNameOf(ctx.people.get(str(d.actor_id) ?? '')) ?? t('notifications.someone')
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
    case 'settlement.created': {
      const fromUser = str(d.from_user)
      const toUser = str(d.to_user)
      const name = (id: string | undefined) =>
        firstNameOf(ctx.people.get(id ?? '')) ?? t('notifications.someone')
      const view =
        n.user_id !== fromUser
          ? {
              title: t('notifications.types.settlement.created.title'),
              body: t('notifications.types.settlement.created.body', {
                payer: fromUser ? name(fromUser) : actor,
                amount,
              }),
            }
          : str(d.actor_id) === toUser
            ? {
                title: t('notifications.types.settlement.sent.title'),
                body: t('notifications.types.settlement.sent.body', {
                  payee: name(toUser),
                  amount,
                }),
              }
            : {
                title: t('notifications.types.settlement.recorded.title'),
                body: t('notifications.types.settlement.recorded.body', {
                  actor,
                  payee: name(toUser),
                  amount,
                }),
              }
      return { ...view, kind: 'payment', target: toGroup('balances') }
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
    case 'expense.deleted':
      return {
        title: t('notifications.types.expense.deleted.title'),
        body: t('notifications.types.expense.deleted.body', { actor, description, group }),
        kind: 'money',
        target: toExpense(),
      }
    case 'expense.restored':
      return {
        title: t('notifications.types.expense.restored.title'),
        body: t('notifications.types.expense.restored.body', { actor, description, group }),
        kind: 'money',
        target: toExpense(),
      }
    case 'member.added':
      return {
        title: t('notifications.types.member.added.title', { group }),
        body: t('notifications.types.member.added.body', { actor }),
        kind: 'people',
        target: toGroup(),
      }
    case 'account.mfa_removed':
      return {
        title: t('notifications.types.account.mfaRemoved.title'),
        body: t('notifications.types.account.mfaRemoved.body'),
        kind: 'other',
        target: { to: '/me' },
      }
    case 'summary.monthly':
      return {
        title: t('notifications.types.summary.monthly.title'),
        body: summaryLine(d.groups, ctx),
        kind: 'summary',
        target: { to: '/home' },
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
