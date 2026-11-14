import { directFriendId, firstName } from '@potluck/core'
import type { NotificationRow } from '@potluck/api'
import { formatDate, formatMoney, formatRelative, formatTime, t } from '@potluck/i18n'

export type NotificationKind =
  'money' | 'payment' | 'people' | 'plan' | 'comment' | 'summary' | 'removed' | 'other'

/** Where tapping a notification goes. Shaped for the router's `navigate`. */
export type NotificationTarget =
  | { to: '/expenses/$expenseId'; params: { expenseId: string } }
  | { to: '/payments/$paymentId'; params: { paymentId: string } }
  | { to: '/plans/$eventId'; params: { eventId: string } }
  | { to: '/groups/$groupId'; params: { groupId: string } }
  | { to: '/groups/$groupId/balances'; params: { groupId: string } }
  | { to: '/groups/$groupId/members'; params: { groupId: string } }
  | { to: '/new/settle'; search: { groupId: string; to?: string }; params?: undefined }
  | { to: '/recurring/$recurringId'; params: { recurringId: string } }
  | { to: '/friends/$friendId'; params: { friendId: string } }
  | { to: '/friends'; params?: undefined }
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
  /** Group names by id, as they read after "in" (`notificationGroupName`). */
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

/**
 * How a group is named inside a notification ("New expense in {group}"): its name, or for a
 * one-on-one tab "your tab with Jules", never the tab's stored name.
 */
export function notificationGroupName(
  group: {
    id: string
    name: string
    is_direct: boolean
    members: { id: string; display_name: string }[]
  },
  viewerId: string,
): string {
  if (!group.is_direct) return group.name
  const friendId = directFriendId(
    { name: group.name, isDirect: true, memberIds: group.members.map((m) => m.id) },
    viewerId,
  )
  const friend = group.members.find((m) => m.id === friendId)
  return friend
    ? t('notifications.directTab', { name: firstName(friend.display_name) })
    : t('notifications.aGroup')
}

/** "Roommates: you are owed $12.50, Hike crew: you owe $5.00 and 1 more group". */
function summaryLine(groups: unknown, ctx: DescribeContext): string {
  const owing = (Array.isArray(groups) ? groups : [])
    .map((g) => (g ?? {}) as Data)
    .filter((g) => (num(g.net_cents) ?? 0) !== 0)
  if (owing.length === 0) return t('notifications.types.summary.monthly.settled')
  const parts = owing.slice(0, 2).map((g) => {
    const net = num(g.net_cents)!
    const groupId = str(g.group_id)
    // The summary names a one-on-one tab after the friend already (`monthly_summary`).
    const group =
      (g.is_direct === true && str(g.name)) ||
      (groupId && ctx.groups.get(groupId)) ||
      str(g.name) ||
      t('notifications.aGroup')
    const amount = formatMoney(Math.abs(net), str(g.currency) ?? 'USD')
    return net > 0
      ? t('notifications.types.summary.owed', { group, amount })
      : t('notifications.types.summary.owe', { group, amount })
  })
  const line = parts.join(', ')
  const more = owing.length - parts.length
  return more > 0 ? `${line} ${t('notifications.types.summary.more', { count: more })}` : line
}

/**
 * What a new expense does to the reader's balance, in its own currency: what they paid minus
 * their share, turned around for a refund (core `expenseEffect`). Positive means they get money
 * back. Zero for rows from before `paid_cents` was stored.
 */
function viewerNet(d: Data): number {
  const share = num(d.share_cents)
  const paid = num(d.paid_cents)
  if (share === undefined || paid === undefined) return 0
  return (d.is_refund === true ? -1 : 1) * (paid - share)
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
  const paymentId = str(d.settlement_id)
  const toPayment = (): NotificationTarget =>
    paymentId ? { to: '/payments/$paymentId', params: { paymentId } } : toGroup('balances')

  const isRefund = d.is_refund === true

  switch (n.type) {
    case 'expense.created': {
      const net = viewerNet(d)
      const yours = net ? formatMoney(Math.abs(net), currency) : ''
      return {
        title: isRefund
          ? t('notifications.types.expense.refund.created', { group })
          : t('notifications.types.expense.created.title', { group }),
        body:
          net < 0
            ? t('notifications.types.expense.yours.owe', { actor, description, amount, yours })
            : net > 0
              ? t('notifications.types.expense.yours.back', { actor, description, amount, yours })
              : t('notifications.types.expense.created.body', { actor, description, amount }),
        kind: 'money',
        target: toExpense(),
      }
    }
    case 'expense.updated':
      return {
        title: isRefund
          ? t('notifications.types.expense.refund.updated')
          : t('notifications.types.expense.updated.title'),
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
      return { ...view, kind: 'payment', target: toPayment() }
    }
    case 'settlement.updated':
    case 'settlement.deleted':
    case 'settlement.restored': {
      const verb = n.type.slice('settlement.'.length) as 'updated' | 'deleted' | 'restored'
      return {
        title: t(`notifications.types.settlement.${verb}.title`),
        body: t(`notifications.types.settlement.${verb}.body`, { actor, amount, group }),
        kind: 'payment',
        target: toPayment(),
      }
    }
    case 'debt.reminder':
      return {
        title: t('notifications.types.debt.reminder.title'),
        body: str(d.note)
          ? t('notifications.types.debt.reminder.bodyWithNote', {
              actor,
              amount,
              group,
              note: str(d.note)!,
            })
          : t('notifications.types.debt.reminder.body', { actor, amount, group }),
        kind: 'payment',
        // Straight to paying them back.
        target: groupId
          ? { to: '/new/settle', search: { groupId, to: str(d.from_user) } }
          : { to: '/notifications' },
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
        target: eventId ? toEvent() : paymentId ? toPayment() : toExpense(),
      }
    case 'expense.deleted':
      return {
        title: isRefund
          ? t('notifications.types.expense.refund.deleted')
          : t('notifications.types.expense.deleted.title'),
        body: t('notifications.types.expense.deleted.body', { actor, description, group }),
        kind: 'money',
        target: toExpense(),
      }
    case 'expense.restored':
      return {
        title: isRefund
          ? t('notifications.types.expense.refund.restored')
          : t('notifications.types.expense.restored.title'),
        body: t('notifications.types.expense.restored.body', { actor, description, group }),
        kind: 'money',
        target: toExpense(),
      }
    case 'friend.added': {
      const friendId = typeof d.user_id === 'string' ? d.user_id : null
      return {
        title: t('notifications.types.friend.added.title'),
        body: t('notifications.types.friend.added.body', { actor }),
        kind: 'people',
        target: friendId ? { to: '/friends/$friendId', params: { friendId } } : { to: '/friends' },
      }
    }
    case 'member.invite_changed':
      return {
        title: t('notifications.types.member.invite_changed.title', { group }),
        body: t('notifications.types.member.invite_changed.body', {
          actor,
          name: firstNameOf(ctx.people.get(str(d.user_id) ?? '')) ?? t('notifications.someone'),
        }),
        kind: 'people',
        target: toGroup('members'),
      }
    case 'group.deleted': {
      // The group is hidden now, so its name comes with the notification; the link opens the
      // deleted group's page, which offers Restore.
      const deletedId = str(d.deleted_group_id)
      const name = str(d.group_name) ?? t('notifications.aGroup')
      return {
        title: t('notifications.types.group.deleted.title', { group: name }),
        body: t('notifications.types.group.deleted.body', { actor }),
        kind: 'removed',
        target: deletedId
          ? { to: '/groups/$groupId', params: { groupId: deletedId } }
          : { to: '/notifications' },
      }
    }
    case 'group.restored':
      return {
        title: t('notifications.types.group.restored.title', {
          group: str(d.group_name) ?? group,
        }),
        body: t('notifications.types.group.restored.body', { actor }),
        kind: 'people',
        target: toGroup(),
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
    case 'recurring.upcoming': {
      const recurringId = str(d.recurring_id)
      const share = num(d.share_cents) ?? 0
      const paid = num(d.paid_cents) ?? 0
      const postsOn = str(d.posts_on)
      // The posting date is a calendar date; the deadline (when it posts) is an instant, shown in
      // the viewer's own zone.
      const deadlineAt = str(d.deadline)
      const line =
        share > 0
          ? t('notifications.types.recurring.upcoming.share', {
              share: formatMoney(share, currency),
              amount,
              group,
            })
          : paid > 0
            ? t('notifications.types.recurring.upcoming.payer', { amount, group })
            : t('notifications.types.recurring.upcoming.plain', { amount, group })
      const deadline = deadlineAt
        ? t('notifications.types.recurring.upcoming.deadline', {
            deadline: `${formatDate(deadlineAt, { timeZone: ctx.timeZone, style: 'weekday' })}, ${formatTime(deadlineAt, { timeZone: ctx.timeZone })}`,
          })
        : ''
      return {
        title: t('notifications.types.recurring.upcoming.title', {
          description,
          date: postsOn ? formatDate(postsOn, { timeZone: 'UTC', style: 'weekday' }) : '',
        }),
        body: deadline ? `${line} ${deadline}` : line,
        kind: 'money',
        target: recurringId
          ? { to: '/recurring/$recurringId', params: { recurringId } }
          : toGroup(),
      }
    }
    case 'recurring.paused': {
      const recurringId = str(d.recurring_id)
      const gone = Array.isArray(d.user_ids) ? d.user_ids.map(str).filter(Boolean) : []
      const name =
        gone.map((id) => firstNameOf(ctx.people.get(id!))).find(Boolean) ??
        t('notifications.someone')
      return {
        title: t('notifications.types.recurring.paused.title', { description }),
        body: t('notifications.types.recurring.paused.body', { name, group }),
        kind: 'money',
        target: recurringId
          ? { to: '/recurring/$recurringId', params: { recurringId } }
          : toGroup(),
      }
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
