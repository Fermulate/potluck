// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BATCH, sweepOrphans, type SweepClient } from './sweep.ts'

function client(paths: string[] | null, { listError = null as unknown, failBatch = -1 } = {}) {
  const removed: string[][] = []
  const fake: SweepClient = {
    rpc: async () => ({ data: paths, error: listError }),
    remove: async (batch) => {
      removed.push(batch)
      return { error: removed.length - 1 === failBatch ? { message: 'boom' } : null }
    },
  }
  return { fake, removed }
}

test('deletes every orphan, a hundred at a time', async () => {
  const paths = Array.from({ length: 250 }, (_, i) => `g/${i}.jpg`)
  const { fake, removed } = client(paths)
  assert.deepEqual(await sweepOrphans(fake), { removed: 250, failed: 0 })
  assert.deepEqual(
    removed.map((b) => b.length),
    [BATCH, BATCH, 50],
  )
})

test('does nothing when nothing is orphaned', async () => {
  const { fake, removed } = client(null)
  assert.deepEqual(await sweepOrphans(fake), { removed: 0, failed: 0 })
  assert.equal(removed.length, 0)
})

test('counts a failed batch and carries on', async () => {
  const { fake } = client(['a', 'b'], { failBatch: 0 })
  assert.deepEqual(await sweepOrphans(fake), { removed: 0, failed: 2 })
})

test('throws when the list cannot be read', async () => {
  const { fake } = client(null, { listError: { message: 'denied' } })
  await assert.rejects(sweepOrphans(fake), { message: 'denied' })
})
