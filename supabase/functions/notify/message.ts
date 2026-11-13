// Push notification copy. No Deno APIs, so the tests run under Node too.
import { copyFor } from './copy.ts'

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  data: Record<string, string | number | null | undefined>
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
  const title = (fallback: string) => String(d.event_title ?? fallback)
  switch (n.type) {
    case 'expense.created':
      return {
        title: c.expenseNew,
        body: String(d.description ?? c.expenseNewBody),
        url: expense,
      }
    case 'expense.updated':
      return {
        title: c.expenseUpdated,
        body: String(d.description ?? c.expenseUpdatedBody),
        url: expense,
      }
    case 'expense.deleted':
      return {
        title: 'Expense deleted',
        body: String(d.description ?? 'An expense was deleted'),
        url: expense,
      }
    case 'expense.restored':
      return {
        title: 'Expense restored',
        body: String(d.description ?? 'An expense is back'),
        url: expense,
      }
    case 'member.added':
      return {
        title: 'You were added to a group',
        body: 'Pull up a chair.',
        url: group,
      }
    case 'settlement.created':
      return { title: c.payment, body: c.paymentBody, url: `${group}/balances` }
    case 'comment.created':
      return {
        title: c.comment,
        body: String(d.excerpt ?? c.commentBody),
        url: d.event_id ? event : expense,
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
    default:
      return { title: 'Potluck', body: c.other, url: '/notifications' }
  }
}
