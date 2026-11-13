// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide, tokenAal } from './cancel.ts'

const token = (claims: object) =>
  `Bearer h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`

test('reads the aal claim, aal1 when it cannot', () => {
  assert.equal(tokenAal(token({ aal: 'aal2' })), 'aal2')
  assert.equal(tokenAal(token({})), 'aal1')
  assert.equal(tokenAal('Bearer nonsense'), 'aal1')
})

test('cancels a pending change back to the current address', () => {
  assert.deepEqual(decide({ email: 'a@x.test', new_email: 'b@x.test' }, 'aal1'), {
    ok: true,
    email: 'a@x.test',
  })
})

test('needs a pending change', () => {
  assert.deepEqual(decide({ email: 'a@x.test', new_email: null }, 'aal1'), {
    ok: false,
    status: 400,
    error: 'no_email_change',
  })
})

test('needs the second step when two-step sign in is on', () => {
  const user = { email: 'a@x.test', new_email: 'b@x.test', factors: [{ status: 'verified' }] }
  assert.equal(decide(user, 'aal1').ok, false)
  assert.equal(decide(user, 'aal2').ok, true)
  const unfinished = { ...user, factors: [{ status: 'unverified' }] }
  assert.equal(decide(unfinished, 'aal1').ok, true)
})
