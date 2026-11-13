// Sends a batch of notification emails. No Deno APIs, so the tests run under Node too.
import { renderEmail, type EmailJob, type EmailLinks } from './email.ts'
import type { EmailSender } from './sender.ts'

export interface DeliveryResult {
  sent: number
  failed: number
  /** Jobs missing a recipient or token. */
  invalid: number
}

function isJob(value: unknown): value is EmailJob {
  const j = value as Partial<EmailJob> | null
  return (
    !!j &&
    typeof j.id === 'string' &&
    typeof j.type === 'string' &&
    typeof j.to === 'string' &&
    j.to.includes('@') &&
    typeof j.unsubscribe === 'string' &&
    typeof j.unsubscribe_all === 'string' &&
    typeof j.data === 'object' &&
    j.data !== null
  )
}

/**
 * One email per job. A failure is counted and the rest still go out; the database marks jobs
 * handled before calling, so nothing is retried (at most once beats a double email).
 */
export async function deliverEmails(
  jobs: unknown[],
  sender: EmailSender,
  links: EmailLinks,
  log: (message: string) => void = () => undefined,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, failed: 0, invalid: 0 }
  for (const job of jobs) {
    if (!isJob(job)) {
      result.invalid++
      continue
    }
    const email = renderEmail(job, links)
    try {
      await sender.send({
        to: job.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: `notification-${job.id}`,
      })
      result.sent++
    } catch (err) {
      result.failed++
      log(`email ${job.id} (${job.type}) failed: ${(err as Error).message}`)
    }
  }
  return result
}
