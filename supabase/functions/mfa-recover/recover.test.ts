// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plausibleCode, recover, type RecoverDeps } from './recover.ts'

function fakeDeps(overrides: Partial<RecoverDeps> = {}) {
  const calls: string[] = []
  const deps: RecoverDeps = {
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
    ...overrides,
  }
  return { deps, calls }
}

test('a matching code removes every factor, then the codes', async () => {
  const { deps, calls } = fakeDeps()
  assert.deepEqual(await recover('u1', 'ABCDE-23456', deps), { ok: true, removed: 2 })
  assert.deepEqual(calls, ['matches u1 ABCDE-23456', 'delete u1 f1', 'delete u1 f2', 'forget u1'])
})

test('a wrong code changes nothing', async () => {
  const { deps, calls } = fakeDeps()
  assert.deepEqual(await recover('u1', 'ZZZZZ-ZZZZZ', deps), {
    ok: false,
    status: 400,
    error: 'invalid_recovery_code',
  })
  assert.deepEqual(calls, ['matches u1 ZZZZZ-ZZZZZ'])
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
