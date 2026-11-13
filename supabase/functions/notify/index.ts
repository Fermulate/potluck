// Fans notifications out beyond the inbox. Called by database hooks with the shared secret:
//   { id, user_id, type, data }  one new notification routed to push (notifications_push trigger)
//   { batch, emails: [...] }     one outbox batch from private.send_email_notifications (cron)
// Web push (VAPID) today; Expo push tokens are skipped until the native app ships.
// Email goes through the sender configured in sender.ts and is off until it is set up.
import webpush from 'npm:web-push@3.6.7'
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'
import { deliverBatch, type BatchReport } from './deliver.ts'
import { message, type NotificationRow } from './message.ts'
import { senderFromEnv } from './sender.ts'

// Supabase's runtime keeps a background task alive after the response (EdgeRuntime.waitUntil).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

const appUrl = Deno.env.get('APP_URL') ?? 'https://potluck.fermulate.com'

async function report(r: BatchReport) {
  const { error } = await adminClient().rpc('email_outbox_report', {
    batch: r.batch,
    delivered: r.delivered,
    error: r.error ?? null,
    rejected: r.rejected,
  })
  if (error) console.error(`report for batch ${r.batch} failed: ${error.message}`)
}

function sendEmails(batch: string, jobs: unknown[]) {
  const sender = senderFromEnv(Deno.env.toObject())
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const work = sender
    ? deliverBatch(batch, jobs, sender, {
        links: { appUrl, oneClickUrl: `${supabaseUrl}/functions/v1/unsubscribe` },
        report,
        log: (line) => console.error(line),
      })
    : report({ batch, delivered: false, error: 'email_not_configured', rejected: [] })
  // pg_net gives up after 5 seconds: answer now and keep sending in the background. If this
  // instance dies first, the outbox re-sends the batch (same idempotency key) after 10 minutes.
  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(work)
    return json({ accepted: jobs.length }, 202)
  }
  return work.then((result) => json(result ?? { skipped: 'email_not_configured' }))
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
  const body = (await req.json()) as NotificationRow | { batch: string; emails: unknown[] }
  if ('emails' in body && Array.isArray(body.emails) && typeof body.batch === 'string') {
    return sendEmails(body.batch, body.emails)
  }
  return sendPush(body as NotificationRow)
})
