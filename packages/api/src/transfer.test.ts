import { describe, expect, it } from 'vitest'
import { fakeSupabase } from './testing/fake-supabase'
import { exportMyData, importExpenses } from './transfer'

const row = {
  kind: 'payment' as const,
  from_user: 'a',
  to_user: 'b',
  amount_cents: 100,
  currency: 'USD',
  paid_on: '2026-03-01',
  note: null,
}

describe('importExpenses', () => {
  it('sends the rows in one call and returns the counts', async () => {
    const fake = fakeSupabase().respond('rpc:import_expenses', {
      data: { expenses: 3, payments: 1 },
    })
    expect(await importExpenses(fake.client, 'g1', [row], 'splitwise')).toEqual({
      expenses: 3,
      payments: 1,
    })
    expect(fake.calls).toEqual([
      {
        kind: 'rpc',
        name: 'import_expenses',
        args: { group_id: 'g1', rows: [row], source: 'splitwise' },
      },
    ])
  })

  it('reads a missing count as zero and throws errors as they come', async () => {
    const ok = fakeSupabase().respond('rpc:import_expenses', { data: null })
    expect(await importExpenses(ok.client, 'g1', [row], 'csv')).toEqual({
      expenses: 0,
      payments: 0,
    })
    const error = { message: 'split_member_not_in_group', hint: 'import_row:4' }
    const failing = fakeSupabase().respond('rpc:import_expenses', { error })
    await expect(importExpenses(failing.client, 'g1', [row], 'csv')).rejects.toBe(error)
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
