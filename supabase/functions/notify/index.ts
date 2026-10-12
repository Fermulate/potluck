// Fans a new notification out to the recipient's push subscriptions.
// Triggered by the notifications insert hook with the shared secret.
// Web push (VAPID) today; Expo push tokens are skipped until the native app ships.
import webpush from 'npm:web-push@3.6.7'
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'

interface NotificationRow {
  id: string
  user_id: string
  type: string
  data: Record<string, string | number | null | undefined>
}

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.potluck-web.workers.dev'

function message(n: NotificationRow): { title: string; body: string; url: string } {
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
    case 'settlement.created':
      return {
        title: 'Payment recorded',
        body: 'Someone settled up with you.',
        url: `${group}/balances`,
      }
    case 'comment.created':
      return {
        title: 'New comment',
        body: String(d.body ?? 'Someone replied'),
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

Deno.serve(async (req) => {
  if (!hasEdgeSecret(req)) return json({ error: 'forbidden' }, 403)

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return json({ skipped: 'vapid_not_configured' })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? appUrl, publicKey, privateKey)

  const n = (await req.json()) as NotificationRow
  const db = adminClient()
  const { data: tokens, error } = await db
    .from('push_tokens')
    .select('token, subscription')
    .eq('user_id', n.user_id)
    .eq('platform', 'web')
  if (error) return json({ error: error.message }, 500)

  const m = message(n)
  const payload = JSON.stringify({
    ...m,
    url: new URL(m.url, appUrl).toString(),
    id: n.id,
    type: n.type,
  })
  let sent = 0
  for (const row of tokens ?? []) {
    if (!row.subscription) continue
    try {
      await webpush.sendNotification(row.subscription, payload, { TTL: 60 * 60 * 24 })
      sent++
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await db.from('push_tokens').delete().eq('user_id', n.user_id).eq('token', row.token)
      }
    }
  }
  return json({ sent })
})
