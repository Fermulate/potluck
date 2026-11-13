// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleUnsubscribe, rpcUnsubscribe, type UnsubscribeOutcome } from './handle.ts'

const url = 'https://db.example/functions/v1/unsubscribe'

function deps(outcome: UnsubscribeOutcome) {
  const tokens: string[] = []
  return {
    tokens,
    deps: {
      appUrl: 'https://potluck.example',
      unsubscribe: async (token: string) => {
        tokens.push(token)
        return outcome
      },
    },
  }
}

test('a one-click POST unsubscribes with the token from the link', async () => {
  const { tokens, deps: d } = deps({ ok: true, category: 'payments' })
  const res = await handleUnsubscribe(
    new Request(`${url}?token=u1.payments.sig`, {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
    d,
  )
  assert.equal(res.status, 200)
  assert.deepEqual(tokens, ['u1.payments.sig'])
})

test('a GET never changes anything, it opens the unsubscribe page', async () => {
  const { tokens, deps: d } = deps({ ok: true, category: 'payments' })
  const res = await handleUnsubscribe(new Request(`${url}?token=u1.payments.sig`), d)
  assert.equal(res.status, 303)
  assert.equal(
    res.headers.get('Location'),
    'https://potluck.example/unsubscribe?token=u1.payments.sig',
  )
  assert.deepEqual(tokens, [])
})

test('bad or missing tokens are refused, other failures ask to retry', async () => {
  assert.equal(
    (
      await handleUnsubscribe(
        new Request(url, { method: 'POST' }),
        deps({ ok: true, category: 'x' }).deps,
      )
    ).status,
    400,
  )
  const invalid = deps({ ok: false, invalid: true, message: 'invalid_unsubscribe_link' })
  assert.equal(
    (await handleUnsubscribe(new Request(`${url}?token=x`, { method: 'POST' }), invalid.deps))
      .status,
    400,
  )
  const down = deps({ ok: false, invalid: false, message: 'HTTP 503' })
  assert.equal(
    (await handleUnsubscribe(new Request(`${url}?token=x`, { method: 'POST' }), down.deps)).status,
    502,
  )
  assert.equal(
    (await handleUnsubscribe(new Request(url, { method: 'PUT' }), down.deps)).status,
    405,
  )
})

test('the RPC call goes to PostgREST as anon with the publishable key', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const call = rpcUnsubscribe('https://db.example/', 'sb_publishable_x', async (u, init) => {
    calls.push({ url: u, init })
    return new Response(
      JSON.stringify({ category: 'payments', email: 'a***@x.y', subscribed: false }),
      {
        status: 200,
      },
    )
  })
  assert.deepEqual(await call('u1.payments.sig'), { ok: true, category: 'payments' })
  assert.equal(calls[0]!.url, 'https://db.example/rest/v1/rpc/email_unsubscribe')
  assert.equal((calls[0]!.init.headers as Record<string, string>).apikey, 'sb_publishable_x')
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    token: 'u1.payments.sig',
    action: 'unsubscribe',
  })

  const refused = rpcUnsubscribe(
    'https://db.example',
    'k',
    async () =>
      new Response(JSON.stringify({ message: 'invalid_unsubscribe_link' }), { status: 400 }),
  )
  assert.deepEqual(await refused('bad'), {
    ok: false,
    invalid: true,
    message: 'invalid_unsubscribe_link',
  })
})
