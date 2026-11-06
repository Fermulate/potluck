// Fans a new notification out to the recipient's push subscriptions.
// Triggered by the notifications insert hook with the shared secret.
// Web push (VAPID) today; Expo push tokens are skipped until the native app ships.
import webpush from 'npm:web-push@3.6.7'
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'
import { message, type NotificationRow } from './message.ts'

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.potluck-web.workers.dev'

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
