import { describe, expect, it } from 'vitest'
import { fakeSupabase } from './testing/fake-supabase'
import {
  exportMyData,
  fetchFxHistory,
  fetchPastImports,
  importExpenses,
  transferKeys,
  transferQueries,
  type ImportFailure,
} from './transfer'

const row = (n = 1) => ({
  kind: 'payment' as const,
  from_user: 'a',
  to_user: 'b',
  amount_cents: n,
  currency: 'USD',
  paid_on: '2026-03-01',
  note: null,
})
const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i + 1))

describe('importExpenses', () => {
  it('sends a small file in one call and returns the counts', async () => {
    const fake = fakeSupabase().respond('rpc:import_expenses', {
      data: { expenses: 3, payments: 1 },
    })
    const progress: number[] = []
    expect(
      await importExpenses(fake.client, 'g1', [row()], 'splitwise', {
        fingerprint: 'sha256:x',
        onProgress: (sent) => progress.push(sent),
      }),
    ).toEqual({ expenses: 3, payments: 1 })
    expect(fake.calls).toEqual([
      {
        kind: 'rpc',
        name: 'import_expenses',
        args: { group_id: 'g1', rows: [row()], source: 'splitwise', fingerprint: 'sha256:x' },
      },
    ])
    expect(progress).toEqual([1])
  })

  it('sends a larger file ahead in parts, then writes it with the last call', async () => {
    const fake = fakeSupabase().respond('rpc:import_expenses', {
      data: { expenses: 0, payments: 4500 },
    })
    await importExpenses(fake.client, 'g1', rows(4500), 'csv', { newId: () => 'batch-1' })
    expect(
      fake.calls.map((c) => {
        const call = c as unknown as { name: string; args: { rows: unknown[] } }
        return [call.name, call.args.rows.length]
      }),
    ).toEqual([
      ['import_stage', 2000],
      ['import_stage', 2000],
      ['import_expenses', 500],
    ])
    expect((fake.calls[2] as unknown as { args: unknown }).args).toMatchObject({
      batch_id: 'batch-1',
      group_id: 'g1',
    })
  })

  it('splits a file past one import into several, and says where one failed', async () => {
    const fake = fakeSupabase().respond(
      'rpc:import_expenses',
      { data: { expenses: 0, payments: 5000 } },
      { error: { message: 'member_not_in_group', code: '23514', hint: 'import_row:7' } },
    )
    let ids = 0
    const failure = (await importExpenses(fake.client, 'g1', rows(6000), 'csv', {
      newId: () => `b${++ids}`,
    }).catch((e: unknown) => e)) as ImportFailure
    expect(failure).toEqual({
      message: 'member_not_in_group',
      code: '23514',
      details: undefined,
      hint: 'import_row:5007',
      imported: { expenses: 0, payments: 5000 },
    })
  })

  it('reads a missing count as zero and passes other errors on', async () => {
    const ok = fakeSupabase().respond('rpc:import_expenses', { data: null })
    expect(await importExpenses(ok.client, 'g1', [row()], 'csv')).toEqual({
      expenses: 0,
      payments: 0,
    })
    const failing = fakeSupabase().respond('rpc:import_expenses', {
      error: { message: 'canceling statement due to statement timeout', code: '57014' },
    })
    await expect(importExpenses(failing.client, 'g1', [row()], 'csv')).rejects.toMatchObject({
      code: '57014',
      hint: null,
      imported: { expenses: 0, payments: 0 },
    })
    const odd = fakeSupabase().respond('rpc:import_expenses', { error: 'offline' as never })
    await expect(importExpenses(odd.client, 'g1', [row()], 'csv')).rejects.toMatchObject({
      message: 'offline',
    })
  })
})

describe('exportMyData', () => {
  const backup = {
    format: 'potluck-backup',
    version: 1,
    exported_at: '2026-03-01T12:00:00+00:00',
    profile: {
      id: '00000000-0000-4000-8000-000000000001',
      display_name: 'Ava',
      email: null,
      avatar_path: null,
      timezone: 'UTC',
      default_currency: 'USD',
      locale: 'en',
      created_at: '2026-03-01T12:00:00+00:00',
    },
    people: [],
    friends: [],
    groups: [],
  }

  it('returns the backup once it checks out', async () => {
    const fake = fakeSupabase().respond('rpc:export_my_data', { data: backup })
    expect(await exportMyData(fake.client)).toEqual(backup)
  })

  it('refuses a document in another format', async () => {
    const fake = fakeSupabase().respond('rpc:export_my_data', { data: { ...backup, version: 9 } })
    await expect(exportMyData(fake.client)).rejects.toThrow()
    const failing = fakeSupabase().respond('rpc:export_my_data', { error: { message: 'x' } })
    await expect(exportMyData(failing.client)).rejects.toEqual({ message: 'x' })
  })
})

describe('rates and earlier imports', () => {
  it('reads every stored rate for a pair and its inverse', async () => {
    const fake = fakeSupabase({
      tables: {
        fx_rates: [
          { base: 'EUR', quote: 'USD', day: '2026-03-01', rate: '1.1' },
          { base: 'EUR', quote: 'USD', day: '2026-04-01', rate: '1.2' },
          { base: 'USD', quote: 'EUR', day: '2026-02-01', rate: '0.9' },
        ],
      },
    })
    expect(await fetchFxHistory(fake.client, 'EUR', 'USD')).toMatchObject({
      direct: [
        { day: '2026-04-01', rate: '1.2' },
        { day: '2026-03-01', rate: '1.1' },
      ],
      inverse: [{ day: '2026-02-01', rate: '0.9' }],
      known: true,
    })
    // No rate for the pair: whether Potluck knows the currency at all.
    expect(await fetchFxHistory(fake.client, 'GBP', 'USD')).toEqual({
      direct: [],
      inverse: [],
      known: false,
    })
    expect(await fetchFxHistory(fake.client, 'EUR', 'JPY')).toEqual({
      direct: [],
      inverse: [],
      known: true,
    })
    const options = transferQueries.fxHistory(fake.client, 'EUR', 'USD')
    expect(options.queryKey).toEqual(transferKeys.fx('EUR', 'USD'))
    expect(await options.queryFn!({} as never)).toHaveProperty('direct')
  })

  it('lists earlier imports with the file they came from', async () => {
    const fake = fakeSupabase({
      tables: {
        activity: [
          {
            group_id: 'g1',
            verb: 'expenses.imported',
            actor_id: 'u1',
            created_at: '2026-03-01T10:00:00Z',
            data: { expenses: 3, payments: 1, fingerprint: 'sha256:x' },
          },
          {
            group_id: 'g1',
            verb: 'expenses.imported',
            actor_id: null,
            created_at: '2026-03-02T10:00:00Z',
            data: null,
          },
          {
            group_id: 'g1',
            verb: 'expense.created',
            actor_id: 'u1',
            created_at: '2026-03-01T10:00:00Z',
            data: {},
          },
        ],
      },
    })
    expect(await fetchPastImports(fake.client, 'g1')).toEqual([
      { at: '2026-03-02T10:00:00Z', actorId: null, fingerprint: null, expenses: 0, payments: 0 },
      {
        at: '2026-03-01T10:00:00Z',
        actorId: 'u1',
        fingerprint: 'sha256:x',
        expenses: 3,
        payments: 1,
      },
    ])
    const options = transferQueries.pastImports(fake.client, 'g1')
    expect(options.queryKey).toEqual(transferKeys.imports('g1'))
    expect(await options.queryFn!({} as never)).toHaveLength(2)
  })
})
