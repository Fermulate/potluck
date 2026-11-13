// Email providers. No Deno APIs, so the tests run under Node too.
//
// Turning email on is configuration only:
//   1. function secrets RESEND_API_KEY and EMAIL_FROM ("Potluck <hello@fermulate.com>"),
//      optionally EMAIL_REPLY_TO;
//   2. update public.app_config set value = 'true' where key = 'email_notifications'.
// Without a key there is no sender and notify answers { skipped: 'email_not_configured' }.
// Another provider is one more branch in senderFromEnv returning an EmailSender.

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  html: string
  headers: Record<string, string>
  /** Same key, same email: lets the provider drop a retried send. */
  idempotencyKey: string
}

export interface EmailSender {
  provider: string
  send(email: OutgoingEmail): Promise<void>
}

export type Env = Record<string, string | undefined>
type Fetch = (input: string, init: RequestInit) => Promise<Response>

export class EmailSendError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(
  apiKey: string,
  from: string,
  replyTo: string | undefined,
  fetchFn: Fetch,
): EmailSender {
  return {
    provider: 'resend',
    async send(email) {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: email.headers,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      })
      if (!res.ok) {
        throw new EmailSendError(`resend answered ${res.status}: ${await res.text()}`, res.status)
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
