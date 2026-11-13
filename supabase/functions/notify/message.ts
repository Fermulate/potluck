// Push notification copy. No Deno APIs, so the tests run under Node too.

export interface NotificationRow {
  id: string
  user_id: string
  type: string
  data: Record<string, string | number | null | undefined>
}

/** Push copy and the in-app path it opens, per notification type. */
export function message(n: NotificationRow): { title: string; body: string; url: string } {
  const d = n.data
  const group = d.group_id ? `/groups/${d.group_id}` : '/home'
  const expense = d.expense_id ? `/expenses/${d.expense_id}` : group
  const event = d.event_id ? `/plans/${d.event_id}` : '/plans'
  const title = (fallback: string) => String(d.event_title ?? fallback)
  switch (n.type) {
    case 'expense.created':
      return {
        title: 'New expense',
        body: String(d.description ?? 'Someone added an expense'),
        url: expense,
      }
    case 'expense.updated':
      return {
        title: 'Expense updated',
        body: String(d.description ?? 'An expense changed'),
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
      return {
        title: 'Payment recorded',
        body: 'Someone settled up with you.',
        url: `${group}/balances`,
      }
    case 'comment.created':
      return {
        title: 'New comment',
        body: String(d.excerpt ?? 'Someone replied'),
        url: d.event_id ? event : expense,
      }
    case 'member.joined':
      return { title: 'New member', body: 'Someone joined your group.', url: `${group}/members` }
    case 'availability.requested':
      return { title: 'When are you free?', body: title('Paint your availability'), url: event }
    case 'event.created':
      return { title: 'New plan', body: title('A new plan is brewing'), url: event }
    case 'event.scheduled':
      return { title: 'It is on', body: title('A plan was locked in'), url: event }
    case 'event.cancelled':
      return { title: 'Plan cancelled', body: title('A plan was called off'), url: event }
    case 'event.reminder':
      return { title: 'Coming up soon', body: title('A plan is coming up'), url: event }
    case 'rsvp.reminder':
      return {
        title: 'Are you in?',
        body: title('Let the group know if you are coming'),
        url: event,
      }
    default:
      return { title: 'Potluck', body: 'Something new is waiting for you.', url: '/notifications' }
  }
}
