// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plausibleCode, recover, type RecoverDeps } from './recover.ts'

/** Deps with a working five-per-window counter, like `record_mfa_recover_attempt`. */
function fakeDeps(overrides: Partial<RecoverDeps> = {}) {
  const calls: string[] = []
  let tries = 0
  const deps: RecoverDeps = {
    allowAttempt: async (user) => {
      calls.push(`attempt ${user}`)
      tries += 1
      return tries <= 5
    },
    matches: async (user, code) => {
      calls.push(`matches ${user} ${code}`)
      return code === 'ABCDE-23456'
    },
    factorIds: async () => ['f1', 'f2'],
    deleteFactor: async (user, id) => {
      calls.push(`delete ${user} ${id}`)
    },
    forgetCodes: async (user) => {
      calls.push(`forget ${user}`)
    },
    notifyRemoved: async (user) => {
      calls.push(`notify ${user}`)
    },
    ...overrides,
  }
  return { deps, calls }
}

test('a matching code removes every factor, then the codes, then tells the account', async () => {
  const { deps, calls } = fakeDeps()
  assert.deepEqual(await recover('u1', 'ABCDE-23456', deps), { ok: true, removed: 2 })
  assert.deepEqual(calls, [
    'attempt u1',
    'matches u1 ABCDE-23456',
    'delete u1 f1',
    'delete u1 f2',
    'forget u1',
    'notify u1',
  ])
})

test('a notice that fails to send does not undo the recovery', async () => {
  const { deps } = fakeDeps({
    notifyRemoved: async () => {
      throw new Error('outbox down')
    },
  })
  assert.deepEqual(await recover('u1', 'ABCDE-23456', deps), { ok: true, removed: 2 })
})

test('a wrong code changes nothing', async () => {
  const { deps, calls } = fakeDeps()
  assert.deepEqual(await recover('u1', 'ZZZZZ-ZZZZZ', deps), {
    ok: false,
    status: 400,
    error: 'invalid_recovery_code',
  })
  assert.deepEqual(calls, ['attempt u1', 'matches u1 ZZZZZ-ZZZZZ'])
})

test('after five tries even the right code waits', async () => {
  const { deps, calls } = fakeDeps()
  for (let i = 0; i < 5; i++) {
    assert.equal((await recover('u1', 'ZZZZZ-ZZZZZ', deps)).ok, false)
  }
  assert.deepEqual(await recover('u1', 'ABCDE-23456', deps), {
    ok: false,
    status: 429,
    error: 'too_many_attempts',
  })
  assert.equal(calls.filter((c) => c.startsWith('matches')).length, 5)
  assert.ok(!calls.some((c) => c.startsWith('delete')))
})

test('nonsense never reaches the database', async () => {
  const { deps, calls } = fakeDeps()
  for (const code of [undefined, 42, '', 'short', 'A'.repeat(40)]) {
    assert.equal((await recover('u1', code, deps)).ok, false)
  }
  assert.deepEqual(calls, [])
  assert.equal(plausibleCode('abcde 23456'), true)
})

test('a failure while removing factors keeps the codes for another try', async () => {
  const { deps, calls } = fakeDeps({
    deleteFactor: async () => {
      throw new Error('auth down')
    },
  })
  assert.deepEqual(await recover('u1', 'ABCDE-23456', deps), {
    ok: false,
    status: 500,
    error: 'recovery_failed',
  })
  assert.ok(!calls.some((c) => c.startsWith('forget')))
})
