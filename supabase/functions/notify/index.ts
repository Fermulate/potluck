// Fans notifications out beyond the inbox. Called by database hooks with the shared secret:
//   { id, user_id, type, data }  one new notification routed to push (notifications_push trigger)
//   { emails: [...] }            due emails from private.send_email_notifications (cron)
// Web push (VAPID) today; Expo push tokens are skipped until the native app ships.
// Email goes through the sender configured in sender.ts and is off until it is set up.
import webpush from 'npm:web-push@3.6.7'
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'
import { deliverEmails } from './deliver.ts'
import { message, type NotificationRow } from './message.ts'
import { senderFromEnv } from './sender.ts'

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.fermulate.com'

async function sendEmails(jobs: unknown[]) {
  const sender = senderFromEnv(Deno.env.toObject())
  if (!sender) return json({ skipped: 'email_not_configured' })
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const result = await deliverEmails(
    jobs,
    sender,
    { appUrl, oneClickUrl: `${supabaseUrl}/functions/v1/unsubscribe` },
    (line) => console.error(line),
  )
  return json(result)
}

async function sendPush(n: NotificationRow) {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return json({ skipped: 'vapid_not_configured' })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? appUrl, publicKey, privateKey)

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
}

Deno.serve(async (req) => {
  if (!hasEdgeSecret(req)) return json({ error: 'forbidden' }, 403)
  const body = (await req.json()) as NotificationRow | { emails: unknown[] }
  if ('emails' in body && Array.isArray(body.emails)) return sendEmails(body.emails)
  return sendPush(body as NotificationRow)
})
