// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backoffMs, deliverBatch, type BatchReport } from './deliver.ts'
import {
  alreadySent,
  EmailSendError,
  isRetryable,
  senderFromEnv,
  type EmailSender,
  type OutgoingEmail,
} from './sender.ts'

const links = {
  appUrl: 'https://potluck.example',
  oneClickUrl: 'https://db.example/functions/v1/unsubscribe',
}

function recordingFetch(...responses: { status: number; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = responses.length > 1 ? responses.shift()! : (responses[0] ?? { status: 200 })
    return new Response(r.status === 200 ? '{"data":[]}' : 'nope', {
      status: r.status,
      headers: r.headers,
    })
  }
  return { calls, fetchFn }
}

const email = (to: string): OutgoingEmail => ({
  to,
  subject: 'Hi',
  text: 'text',
  html: '<p>html</p>',
  headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
})

const job = (id: string, to = `${id}@example.com`) => ({
  id,
  type: 'expense.created',
  category: 'expense_added',
  to,
  unsubscribe: `${id}.expense_added.sig`,
  unsubscribe_all: `${id}.all.sig`,
  data: { expense_id: 'x1', description: 'Pizza', actor_name: 'Ava' },
})

function recordingSender(failures: unknown[] = [], maxBatch = 100) {
  const calls: { emails: OutgoingEmail[]; key: string }[] = []
  const sender: EmailSender = {
    provider: 'test',
    maxBatch,
    async sendBatch(emails, key) {
      calls.push({ emails, key })
      const failure = failures.shift()
      if (failure) throw failure
    },
  }
  return { calls, sender }
}

function harness() {
  const reports: BatchReport[] = []
  const waits: number[] = []
  return {
    reports,
    waits,
    options: {
      links,
      report: async (r: BatchReport) => {
        reports.push(r)
      },
      sleep: async (ms: number) => {
        waits.push(ms)
      },
    },
  }
}

test('no sender until a key and a from address are configured', () => {
  const { fetchFn } = recordingFetch()
  assert.equal(senderFromEnv({}, fetchFn), null)
  assert.equal(senderFromEnv({ RESEND_API_KEY: 're_x' }, fetchFn), null)
  assert.equal(senderFromEnv({ EMAIL_FROM: 'Potluck <a@b.c>' }, fetchFn), null)
  assert.equal(
    senderFromEnv(
      { EMAIL_PROVIDER: 'carrier-pigeon', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' },
      fetchFn,
    ),
    null,
  )
  assert.equal(
    senderFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' }, fetchFn)?.provider,
    'resend',
  )
})

test('resend gets the whole batch in one call with the idempotency key', async () => {
  const { calls, fetchFn } = recordingFetch({ status: 200 })
  const sender = senderFromEnv(
    {
      RESEND_API_KEY: 're_secret',
      EMAIL_FROM: 'Potluck <hello@example.com>',
      EMAIL_REPLY_TO: 'help@example.com',
    },
    fetchFn,
  )!
  await sender.sendBatch([email('ben@example.com'), email('cleo@example.com')], 'batch-b1')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails/batch')
  const headers = calls[0]!.init.headers as Record<string, string>
  assert.equal(headers.Authorization, 'Bearer re_secret')
  assert.equal(headers['Idempotency-Key'], 'batch-b1')
  const body = JSON.parse(String(calls[0]!.init.body))
  assert.equal(body.length, 2)
  assert.deepEqual(body[0], {
    from: 'Potluck <hello@example.com>',
    to: ['ben@example.com'],
    subject: 'Hi',
    text: 'text',
    html: '<p>html</p>',
    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    reply_to: 'help@example.com',
  })
})

test('a provider error carries its status and Retry-After', async () => {
  const { fetchFn } = recordingFetch({ status: 429, headers: { 'Retry-After': '3' } })
  const sender = senderFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' }, fetchFn)!
  await assert.rejects(
    sender.sendBatch([email('x@y.z')], 'k'),
    (err: EmailSendError) => err.status === 429 && err.retryAfter === 3,
  )
  assert.equal(isRetryable(new EmailSendError('rate', 429)), true)
  assert.equal(isRetryable(new EmailSendError('down', 503)), true)
  assert.equal(isRetryable(new EmailSendError('bad from', 422)), false)
  assert.equal(isRetryable(new TypeError('network')), true)
})

test('a batch goes out in one call and is reported delivered, malformed jobs rejected', async () => {
  const { calls, sender } = recordingSender()
  const h = harness()
  const result = await deliverBatch(
    'b1',
    [job('n1'), job('n2'), { id: 'n3' }, null],
    sender,
    h.options,
  )
  assert.deepEqual(result, { sent: 2, failed: 0, invalid: 2 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.key, 'batch-b1')
  assert.equal(calls[0]!.emails[0]!.subject, 'Ava added "Pizza"')
  assert.match(calls[0]!.emails[0]!.headers['List-Unsubscribe']!, /token=n1\.expense_added\.sig/)
  assert.deepEqual(h.reports, [{ batch: 'b1', delivered: true, rejected: ['n3'] }])
})

test('rate limits back off and retry with the same key, honoring Retry-After', async () => {
  const { calls, sender } = recordingSender([
    new EmailSendError('slow down', 429, 2),
    new EmailSendError('busy', 503),
  ])
  const h = harness()
  const result = await deliverBatch('b2', [job('n1')], sender, h.options)
  assert.deepEqual(result, { sent: 1, failed: 0, invalid: 0 })
  assert.deepEqual(
    calls.map((c) => c.key),
    ['batch-b2', 'batch-b2', 'batch-b2'],
  )
  assert.deepEqual(h.waits, [2000, 1000])
  assert.equal(h.reports[0]!.delivered, true)
})

test('a batch that keeps failing is reported failed so the outbox retries it later', async () => {
  const down = () => new EmailSendError('down', 500)
  const { calls, sender } = recordingSender([down(), down(), down(), down()])
  const h = harness()
  const result = await deliverBatch('b3', [job('n1'), job('n2')], sender, {
    ...h.options,
    tries: 4,
  })
  assert.deepEqual(result, { sent: 0, failed: 2, invalid: 0 })
  assert.equal(calls.length, 4)
  assert.deepEqual(h.waits, [500, 1000, 2000])
  assert.deepEqual(h.reports, [{ batch: 'b3', delivered: false, error: 'down', rejected: [] }])
})

test('a permanent error is not retried', async () => {
  const { calls, sender } = recordingSender([new EmailSendError('bad from', 422)])
  const h = harness()
  await deliverBatch('b4', [job('n1')], sender, h.options)
  assert.equal(calls.length, 1)
  assert.equal(h.reports[0]!.delivered, false)
})

test('a provider that takes fewer emails per call gets several keyed calls', async () => {
  const { calls, sender } = recordingSender([], 2)
  const h = harness()
  await deliverBatch('b5', [job('n1'), job('n2'), job('n3')], sender, h.options)
  assert.deepEqual(
    calls.map((c) => [c.key, c.emails.length]),
    [
      ['batch-b5-0', 2],
      ['batch-b5-1', 1],
    ],
  )
})

test('a batch with nothing sendable is still reported, so its rows do not hang', async () => {
  const { calls, sender } = recordingSender()
  const h = harness()
  await deliverBatch('b6', [{ id: 'n9', to: 'not-an-address' }], sender, h.options)
  assert.equal(calls.length, 0)
  assert.deepEqual(h.reports, [{ batch: 'b6', delivered: true, rejected: ['n9'] }])
})

test('backoff doubles and is capped by what the provider asks', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((a) => backoffMs(a)),
    [500, 1000, 2000, 4000],
  )
  assert.equal(backoffMs(0, 90), 30_000)
})

test('a 409 for a key resend already accepted counts as sent; one still in flight is retried', async () => {
  const fetchFn = async () =>
    new Response(JSON.stringify({ statusCode: 409, name: 'invalid_idempotent_request' }), {
      status: 409,
    })
  const resend = senderFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' }, fetchFn)!
  const err = await resend.sendBatch([email('x@y.z')], 'k').catch((e: unknown) => e)
  assert.equal((err as EmailSendError).code, 'invalid_idempotent_request')
  assert.equal(alreadySent(err), true)
  assert.equal(isRetryable(err), false)

  const same = recordingSender([err])
  const h1 = harness()
  const result = await deliverBatch('b7', [job('n1')], same.sender, h1.options)
  assert.equal(same.calls.length, 1)
  assert.deepEqual(result, { sent: 1, failed: 0, invalid: 0 })
  assert.deepEqual(h1.reports, [{ batch: 'b7', delivered: true, rejected: [] }])

  const busy = new EmailSendError('busy', 409, undefined, 'concurrent_idempotent_requests')
  assert.equal(isRetryable(busy), true)
  assert.equal(alreadySent(busy), false)
  const inFlight = recordingSender([busy])
  const h2 = harness()
  await deliverBatch('b8', [job('n1')], inFlight.sender, h2.options)
  assert.equal(inFlight.calls.length, 2)
  assert.equal(h2.reports[0]!.delivered, true)
  assert.equal(isRetryable(new EmailSendError('conflict', 409)), false)
})
