// Email providers. No Deno APIs, so the tests run under Node too.
//
// Turning email on is configuration only:
//   1. function secrets RESEND_API_KEY and EMAIL_FROM ("Potluck <hello@fermulate.com>"),
//      optionally EMAIL_REPLY_TO;
//   2. update public.app_config set value = 'true' where key = 'email_notifications'.
// Without a key there is no sender and notify reports the batch as failed.
// Another provider is one more branch in senderFromEnv returning an EmailSender.

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  html: string
  headers: Record<string, string>
}

export interface EmailSender {
  provider: string
  /** Most emails one call takes. */
  maxBatch: number
  /**
   * Sends every email in one call, all or nothing. Same key, same batch: the provider drops a
   * repeat of a batch it already accepted.
   */
  sendBatch(emails: OutgoingEmail[], idempotencyKey: string): Promise<void>
}

export type Env = Record<string, string | undefined>
type Fetch = (input: string, init: RequestInit) => Promise<Response>

export class EmailSendError extends Error {
  status: number
  /** Seconds the provider asked us to wait (Retry-After), if any. */
  retryAfter: number | undefined
  constructor(message: string, status: number, retryAfter?: number) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** Rate limits, server errors and dropped connections are worth another try. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof EmailSendError) return err.status === 429 || err.status >= 500
  return true
}

/** Resend's batch API (https://resend.com/docs/api-reference/emails/send-batch-emails). */
export function resendSender(
  apiKey: string,
  from: string,
  replyTo: string | undefined,
  fetchFn: Fetch,
): EmailSender {
  return {
    provider: 'resend',
    maxBatch: 100,
    async sendBatch(emails, idempotencyKey) {
      const res = await fetchFn('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(
          emails.map((email) => ({
            from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            html: email.html,
            headers: email.headers,
            ...(replyTo ? { reply_to: replyTo } : {}),
          })),
        ),
      })
      if (!res.ok) {
        const wait = Number(res.headers.get('retry-after'))
        throw new EmailSendError(
          `resend answered ${res.status}: ${await res.text()}`,
          res.status,
          Number.isFinite(wait) && wait > 0 ? wait : undefined,
        )
      }
    },
  }
}

/** The configured sender, or null when email is not set up. */
export function senderFromEnv(env: Env, fetchFn: Fetch = fetch): EmailSender | null {
  const provider = (env.EMAIL_PROVIDER ?? 'resend').toLowerCase()
  const from = env.EMAIL_FROM?.trim()
  if (!from) return null
  if (provider === 'resend' && env.RESEND_API_KEY) {
    return resendSender(env.RESEND_API_KEY, from, env.EMAIL_REPLY_TO?.trim() || undefined, fetchFn)
  }
  return null
}
