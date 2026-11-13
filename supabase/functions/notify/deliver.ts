// Sends one outbox batch of notification emails. No Deno APIs, so the tests run under Node too.
//
// private.send_email_notifications hands notify { batch, emails } and marks the rows sending.
// Whatever happens here ends in exactly one report to public.email_outbox_report: delivered
// (the rows are sent), or failed (the database retries them later with backoff, up to 5 times).
// If notify dies before reporting, the database re-sends the same batch after 10 minutes, and
// the batch id doubles as the provider's idempotency key so it is not delivered twice.
import { renderEmail, type EmailJob, type EmailLinks } from './email.ts'
import { alreadySent, isRetryable, type EmailSender, type OutgoingEmail } from './sender.ts'

export interface BatchReport {
  batch: string
  delivered: boolean
  error?: string
  /** Jobs that could not be built (no address, no token); dropped for good. */
  rejected: string[]
}

export interface DeliverOptions {
  links: EmailLinks
  report: (report: BatchReport) => Promise<void>
  /** Waits between tries; injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Tries per batch inside one call (rate limits and server errors only). */
  tries?: number
  log?: (message: string) => void
}

export interface DeliveryResult {
  sent: number
  failed: number
  invalid: number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

/** Exponential backoff (0.5 s, 1 s, 2 s, ...) unless the provider said how long to wait. */
export function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) return Math.min(retryAfterSeconds, 30) * 1000
  return 500 * 2 ** attempt
}

export async function deliverBatch(
  batch: string,
  jobs: unknown[],
  sender: EmailSender,
  options: DeliverOptions,
): Promise<DeliveryResult> {
  const sleep = options.sleep ?? defaultSleep
  const tries = options.tries ?? 4
  const log = options.log ?? (() => undefined)

  const valid = jobs.filter(isJob)
  const rejected = jobs
    .filter((job) => !isJob(job))
    .map((job) => (job as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string')
  const invalid = jobs.length - valid.length

  if (valid.length === 0) {
    await options.report({ batch, delivered: true, rejected })
    return { sent: 0, failed: 0, invalid }
  }

  const emails: OutgoingEmail[] = valid.map((job) => {
    const email = renderEmail(job, options.links)
    return {
      to: job.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
    }
  })

  // The database cuts batches small enough for one call; split anyway if a provider takes fewer.
  const chunks: OutgoingEmail[][] = []
  for (let i = 0; i < emails.length; i += sender.maxBatch) {
    chunks.push(emails.slice(i, i + sender.maxBatch))
  }

  let lastError: unknown
  for (const [index, chunk] of chunks.entries()) {
    const key = chunks.length === 1 ? `batch-${batch}` : `batch-${batch}-${index}`
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        await sender.sendBatch(chunk, key)
        lastError = undefined
        break
      } catch (err) {
        if (alreadySent(err)) {
          log(`batch ${batch}: key already used, the provider has this batch`)
          lastError = undefined
          break
        }
        lastError = err
        log(`batch ${batch} try ${attempt + 1} failed: ${(err as Error).message}`)
        if (!isRetryable(err) || attempt === tries - 1) break
        await sleep(backoffMs(attempt, (err as { retryAfter?: number }).retryAfter))
      }
    }
    if (lastError) break
  }

  if (lastError) {
    await options.report({
      batch,
      delivered: false,
      error: (lastError as Error).message ?? String(lastError),
      rejected,
    })
    return { sent: 0, failed: valid.length, invalid }
  }
  await options.report({ batch, delivered: true, rejected })
  return { sent: valid.length, failed: 0, invalid }
}
