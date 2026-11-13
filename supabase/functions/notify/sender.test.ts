// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverEmails } from './deliver.ts'
import { senderFromEnv, type EmailSender, type OutgoingEmail } from './sender.ts'

const links = {
  appUrl: 'https://potluck.example',
  oneClickUrl: 'https://db.example/functions/v1/unsubscribe',
}

function recordingFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(status === 200 ? '{"id":"r1"}' : 'nope', { status })
  }
  return { calls, fetchFn }
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

test('resend gets the message, the unsubscribe headers and an idempotency key', async () => {
  const { calls, fetchFn } = recordingFetch()
  const sender = senderFromEnv(
    {
      RESEND_API_KEY: 're_secret',
      EMAIL_FROM: 'Potluck <hello@example.com>',
      EMAIL_REPLY_TO: 'help@example.com',
    },
    fetchFn,
  )!
  const email: OutgoingEmail = {
    to: 'ben@example.com',
    subject: 'Hi',
    text: 'text',
    html: '<p>html</p>',
    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    idempotencyKey: 'notification-n1',
  }
  await sender.send(email)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails')
  const headers = calls[0]!.init.headers as Record<string, string>
  assert.equal(headers.Authorization, 'Bearer re_secret')
  assert.equal(headers['Idempotency-Key'], 'notification-n1')
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    from: 'Potluck <hello@example.com>',
    to: ['ben@example.com'],
    subject: 'Hi',
    text: 'text',
    html: '<p>html</p>',
    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    reply_to: 'help@example.com',
  })
})

test('a provider error is thrown with its status', async () => {
  const { fetchFn } = recordingFetch(422)
  const sender = senderFromEnv({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.c' }, fetchFn)!
  await assert.rejects(
    sender.send({
      to: 'x@y.z',
      subject: 's',
      text: 't',
      html: 'h',
      headers: {},
      idempotencyKey: 'k',
    }),
    (err: Error & { status?: number }) => err.status === 422,
  )
})

test('a batch sends one email per job, counts failures and skips malformed jobs', async () => {
  const sent: OutgoingEmail[] = []
  const sender: EmailSender = {
    provider: 'test',
    async send(email) {
      if (email.to === 'broken@example.com') throw new Error('mailbox on fire')
      sent.push(email)
    },
  }
  const job = (id: string, to: string) => ({
    id,
    type: 'expense.created',
    category: 'expense_added',
    to,
    unsubscribe: `${id}.expense_added.sig`,
    unsubscribe_all: `${id}.all.sig`,
    data: { expense_id: 'x1', description: 'Pizza', actor_name: 'Ava' },
  })
  const logged: string[] = []
  const result = await deliverEmails(
    [job('n1', 'ava@example.com'), job('n2', 'broken@example.com'), { id: 'n3' }, null],
    sender,
    links,
    (line) => logged.push(line),
  )
  assert.deepEqual(result, { sent: 1, failed: 1, invalid: 2 })
  assert.equal(sent[0]!.idempotencyKey, 'notification-n1')
  assert.equal(sent[0]!.subject, 'Ava added "Pizza"')
  assert.match(sent[0]!.headers['List-Unsubscribe']!, /token=n1\.expense_added\.sig/)
  assert.match(logged[0]!, /n2 \(expense\.created\) failed: mailbox on fire/)
})
