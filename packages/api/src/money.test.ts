import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activityInfiniteQueryOptions,
  addExpenseComment,
  createExpense,
  deleteExpense,
  deleteExpenseComment,
  deleteRecurring,
  deleteSettlement,
  fetchActivity,
  fetchExpense,
  fetchExpenseComments,
  fetchFxCurrencies,
  fetchFxRate,
  fetchGroupBalances,
  fetchGroupExpenses,
  fetchGroupSettlements,
  fetchMoneyGroup,
  fetchMoneyGroups,
  fetchPeople,
  fetchReceiptUrl,
  fetchRecurringExpenses,
  fetchSimplifiedDebts,
  moneyErrorCode,
  moneyKeys,
  moneyQueries,
  restoreExpense,
  setRecurringActive,
  settleUp,
  updateExpense,
  uploadReceipt,
  type ExpensePayload,
} from './money'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_allowed', code: 'P0001' }

afterEach(() => {
  vi.useRealTimers()
})

describe('moneyErrorCode', () => {
  it('returns snake_case codes raised by the database', () => {
    expect(moneyErrorCode({ message: 'splits_sum_mismatch' })).toBe('splits_sum_mismatch')
    expect(moneyErrorCode(new Error('not_allowed'))).toBe('not_allowed')
  })

  it('ignores anything that is not one of our codes', () => {
    expect(moneyErrorCode(null)).toBeNull()
    expect(moneyErrorCode('not_allowed')).toBeNull()
    expect(moneyErrorCode({})).toBeNull()
    expect(moneyErrorCode({ message: 42 })).toBeNull()
    expect(moneyErrorCode(new Error('Failed to fetch'))).toBeNull()
    expect(moneyErrorCode({ message: 'Not_allowed' })).toBeNull()
  })
})

describe('fetchPeople', () => {
  it('returns every visible profile', async () => {
    const people = [{ id: 'u1' }, { id: 'u2' }]
    const fake = fakeSupabase({ tables: { profiles: people } })
    expect(await fetchPeople(fake.client)).toEqual(people)
  })
})

describe('money groups', () => {
  const ada = { id: 'u1', display_name: 'Ada', avatar_path: null, deleted_at: null }
  const bo = { id: 'u2', display_name: 'Bo', avatar_path: 'u2/a.jpg', deleted_at: null }
  const row = {
    id: 'g1',
    name: 'Flat',
    currency: 'EUR',
    group_members: [
      { role: 'member', profiles: bo },
      { role: 'owner', profiles: ada },
      { role: 'member', profiles: null },
    ],
  }

  it('flattens members, drops hidden profiles and sorts by name', async () => {
    const fake = fakeSupabase().respond('from:groups', { data: row })

    const group = await fetchMoneyGroup(fake.client, 'g1')

    expect(group).toEqual({
      id: 'g1',
      name: 'Flat',
      currency: 'EUR',
      members: [
        { ...ada, role: 'owner' },
        { ...bo, role: 'member' },
      ],
    })
    expect(argsOf(fake.queries('groups')[0]!, 'eq')).toEqual([['id', 'g1']])
  })

  it('lists live groups alphabetically', async () => {
    const fake = fakeSupabase().respond('from:groups', {
      data: [row, { ...row, id: 'g2', group_members: [] }],
    })

    const groups = await fetchMoneyGroups(fake.client)

    expect(groups.map((g) => [g.id, g.members.length])).toEqual([
      ['g1', 2],
      ['g2', 0],
    ])
    const [query] = fake.queries('groups')
    expect(argsOf(query!, 'is')).toEqual([['archived_at', null]])
    expect(argsOf(query!, 'order')).toEqual([['name']])
  })

  it('throws when the group cannot be read', async () => {
    const fake = fakeSupabase().respond('from:groups', { error: boom })
    await expect(fetchMoneyGroup(fake.client, 'g1')).rejects.toBe(boom)
    await expect(fetchMoneyGroups(fake.client)).rejects.toBe(boom)
  })
})

describe('fetchGroupExpenses', () => {
  it('reads fx_rate as decimal text, so no digit is lost on the way to convert()', async () => {
    const fake = fakeSupabase({ tables: { expenses: [] } })
    await fetchGroupExpenses(fake.client, 'g1')
    const [query] = fake.queries('expenses')
    expect(String(argsOf(query!, 'select')[0]?.[0])).toContain('fx_rate::text')
  })

  it('returns every live expense even past the per response row cap', async () => {
    const expenses = Array.from({ length: 2500 }, (_, i) => ({
      id: `e${i}`,
      group_id: 'g1',
      deleted_at: null,
      spent_at: `2026-01-01T00:00:${String(i).padStart(5, '0')}`,
      created_at: '2026-01-01',
      expense_splits: [],
    }))
    const other = { id: 'x', group_id: 'g2', deleted_at: null, spent_at: '2026-01-01' }
    const deleted = { id: 'd', group_id: 'g1', deleted_at: '2026-02-01', spent_at: '2026-01-01' }
    const fake = fakeSupabase({ tables: { expenses: [...expenses, other, deleted] } })

    const rows = await fetchGroupExpenses(fake.client, 'g1')

    expect(rows).toHaveLength(2500)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500)
    expect(rows[0]!.id).toBe('e2499')
    expect(fake.queries('expenses').map((q) => argsOf(q, 'range')[0])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('stops after one page when the first page is short', async () => {
    const fake = fakeSupabase({ tables: { expenses: [] } })
    expect(await fetchGroupExpenses(fake.client, 'g1')).toEqual([])
    expect(fake.queries('expenses')).toHaveLength(1)
  })

  it('throws a page error', async () => {
    const fake = fakeSupabase().respond('from:expenses', { error: boom })
    await expect(fetchGroupExpenses(fake.client, 'g1')).rejects.toBe(boom)
  })
})

describe('fetchGroupSettlements', () => {
  it('reads live settlements for the group, newest first', async () => {
    const fake = fakeSupabase({
      tables: {
        settlements: [
          { id: 's1', group_id: 'g1', deleted_at: null, settled_at: '2026-01-01' },
          { id: 's2', group_id: 'g1', deleted_at: null, settled_at: '2026-03-01' },
          { id: 's3', group_id: 'g1', deleted_at: '2026-04-01', settled_at: '2026-02-01' },
          { id: 's4', group_id: 'g2', deleted_at: null, settled_at: '2026-02-01' },
        ],
      },
    })

    const rows = await fetchGroupSettlements(fake.client, 'g1')

    expect(rows.map((r) => r.id)).toEqual(['s2', 's1'])
  })

  it('reads fx_rate as decimal text, so no digit is lost on the way to convert()', async () => {
    const fake = fakeSupabase({ tables: { settlements: [] } })
    await fetchGroupSettlements(fake.client, 'g1')
    const [query] = fake.queries('settlements')
    expect(String(argsOf(query!, 'select')[0]?.[0])).toContain('fx_rate::text')
  })
})

describe('fetchGroupBalances', () => {
  it('drops rows without a user and treats a null net as zero', async () => {
    const fake = fakeSupabase().respond('from:group_balances', {
      data: [
        { user_id: 'u1', net_cents: 500 },
        { user_id: null, net_cents: 1 },
        { user_id: 'u2', net_cents: null },
      ],
    })

    expect(await fetchGroupBalances(fake.client, 'g1')).toEqual([
      { user_id: 'u1', net_cents: 500 },
      { user_id: 'u2', net_cents: 0 },
    ])
    expect(argsOf(fake.queries('group_balances')[0]!, 'eq')).toEqual([['group_id', 'g1']])
  })
})

describe('single reads', () => {
  it('fetchSimplifiedDebts calls simplified_debts for the group', async () => {
    const debts = [{ from_user: 'u1', to_user: 'u2', amount_cents: 300 }]
    const fake = fakeSupabase().respond('rpc:simplified_debts', { data: debts })
    expect(await fetchSimplifiedDebts(fake.client, 'g1')).toEqual(debts)
    expect(fake.rpcArgs('simplified_debts')).toEqual([{ group_id: 'g1' }])
  })

  it('fetchExpense reads one expense with its splits, deleted or not', async () => {
    const fake = fakeSupabase({
      tables: { expenses: [{ id: 'e1', deleted_at: '2026-01-01', expense_splits: [] }] },
    })
    expect(await fetchExpense(fake.client, 'e1')).toMatchObject({ id: 'e1' })
    await expect(fetchExpense(fake.client, 'missing')).rejects.toMatchObject({
      message: expect.stringContaining('no) rows'),
    })
  })

  it('fetchExpenseComments reads live comments oldest first', async () => {
    const fake = fakeSupabase({
      tables: {
        comments: [
          { id: 'c2', expense_id: 'e1', deleted_at: null, created_at: '2026-01-02' },
          { id: 'c1', expense_id: 'e1', deleted_at: null, created_at: '2026-01-01' },
          { id: 'c3', expense_id: 'e1', deleted_at: '2026-01-03', created_at: '2026-01-03' },
          { id: 'c4', expense_id: 'e2', deleted_at: null, created_at: '2026-01-01' },
        ],
      },
    })
    const rows = await fetchExpenseComments(fake.client, 'e1')
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2'])
  })

  it('fetchRecurringExpenses orders by the next run', async () => {
    const fake = fakeSupabase({
      tables: {
        recurring_expenses: [
          { id: 'r1', group_id: 'g1', next_run_on: '2026-05-01' },
          { id: 'r2', group_id: 'g1', next_run_on: '2026-04-01' },
        ],
      },
    })
    const rows = await fetchRecurringExpenses(fake.client, 'g1')
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1'])
  })
})

describe('fetchFxRate', () => {
  const fxRates = [
    // `rate::text`, as PostgREST returns it
    { base: 'EUR', quote: 'USD', day: '2026-03-01', rate: '1.100000000000' },
    { base: 'EUR', quote: 'USD', day: '2026-06-01', rate: '1.200000000000' },
    { base: 'USD', quote: 'GBP', day: '2026-06-01', rate: '0.800000000000' },
    { base: 'USD', quote: 'JPY', day: '2026-06-01', rate: '150.000000000000' },
    { base: 'IDR', quote: 'EUR', day: '2026-06-01', rate: '0.000057600000' },
  ]
  const { client } = fakeSupabase({ tables: { fx_rates: fxRates } })

  it('is 1 for the same currency without a lookup', async () => {
    const fake = fakeSupabase()
    expect(await fetchFxRate(fake.client, 'EUR', 'EUR', '2026-01-01')).toEqual({
      rate: '1',
      day: '',
    })
    expect(fake.calls).toHaveLength(0)
  })

  it('uses the newest rate on or before the expense day, like private.fx_rate', async () => {
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-04-15')).toEqual({
      rate: '1.100000000000',
      day: '2026-03-01',
    })
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-06-01')).toEqual({
      rate: '1.200000000000',
      day: '2026-06-01',
    })
  })

  it('has no rate for a day before the first known rate', async () => {
    expect(await fetchFxRate(client, 'EUR', 'USD', '2026-02-28')).toBeNull()
    expect(await fetchFxRate(client, 'GBP', 'USD', '2026-05-31')).toBeNull()
  })

  it('falls back to the inverse pair, rounded to 12 places', async () => {
    // 1 / 150 = 0.0066666..., so the width of the rounding is visible.
    expect(await fetchFxRate(client, 'JPY', 'USD', '2026-07-01')).toEqual({
      rate: '0.006666666667',
      day: '2026-06-01',
    })
  })

  it('keeps every digit of a large inverse, like round(1 / rate, 12)', async () => {
    // 1 / 0.0000576 = 17361.111111111111; as a JS number it would be 17361.11111111111.
    expect(await fetchFxRate(client, 'EUR', 'IDR', '2026-07-01')).toEqual({
      rate: '17361.111111111111',
      day: '2026-06-01',
    })
  })

  it('throws a lookup error', async () => {
    const fake = fakeSupabase().respond('from:fx_rates', { error: boom })
    await expect(fetchFxRate(fake.client, 'EUR', 'USD', '2026-01-01')).rejects.toBe(boom)
  })
})

describe('fetchFxCurrencies', () => {
  it('lists the other side of every pair touching the target, sorted and unique', async () => {
    const fake = fakeSupabase().respond('from:fx_rates', {
      data: [
        { base: 'USD', quote: 'EUR' },
        { base: 'EUR', quote: 'GBP' },
        { base: 'USD', quote: 'EUR' },
        { base: 'EUR', quote: 'EUR' },
        { base: 'CHF', quote: 'EUR' },
      ],
    })

    expect(await fetchFxCurrencies(fake.client, 'EUR', '2026-05-01')).toEqual(['CHF', 'GBP', 'USD'])
    const [query] = fake.queries('fx_rates')
    expect(argsOf(query!, 'or')).toEqual([['base.eq.EUR,quote.eq.EUR']])
    expect(argsOf(query!, 'lte')).toEqual([['day', '2026-05-01']])
    expect(argsOf(query!, 'limit')).toEqual([[1000]])
  })
})

describe('fetchActivity', () => {
  it('reads the newest page by default', async () => {
    const fake = fakeSupabase().respond('from:activity', { data: [{ id: 'a1' }] })

    expect(await fetchActivity(fake.client)).toEqual([{ id: 'a1' }])
    const [query] = fake.queries('activity')
    expect(argsOf(query!, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(argsOf(query!, 'limit')).toEqual([[30]])
    expect(argsOf(query!, 'or')).toEqual([])
  })

  it('pages after a (created_at, id) cursor with a custom limit', async () => {
    const fake = fakeSupabase().respond('from:activity', { data: [] })

    await fetchActivity(fake.client, {
      before: { createdAt: '2026-01-01T00:00:00.5+00:00', id: 'a9' },
      limit: 10,
    })

    const [query] = fake.queries('activity')
    expect(argsOf(query!, 'limit')).toEqual([[10]])
    expect(argsOf(query!, 'or')).toEqual([
      [
        'created_at.lt."2026-01-01T00:00:00.5+00:00",and(created_at.eq."2026-01-01T00:00:00.5+00:00",id.lt."a9")',
      ],
    ])
  })

  it('walks every row once, even when many share a timestamp across a page break', async () => {
    // 45 rows written in the same instant (a bulk import), then 25 older ones.
    const rows = [
      ...Array.from({ length: 45 }, (_, i) => ({
        id: `b${String(i).padStart(2, '0')}`,
        created_at: '2026-02-01T10:00:00+00:00',
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        id: `a${String(i).padStart(2, '0')}`,
        created_at: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00+00:00`,
      })),
    ]
    const fake = fakeSupabase({ tables: { activity: rows } })
    const { initialPageParam, getNextPageParam } = activityInfiniteQueryOptions(fake.client)

    const seen: string[] = []
    let cursor = initialPageParam
    for (let i = 0; i < 10; i++) {
      const page = await fetchActivity(fake.client, { before: cursor })
      seen.push(...page.map((r) => r.id))
      cursor = getNextPageParam(page, [page], cursor, [cursor]) ?? undefined
      if (!cursor) break
    }

    expect(seen).toHaveLength(70)
    expect(new Set(seen).size).toBe(70)
    expect(seen.slice(0, 2)).toEqual(['b44', 'b43'])
    expect(seen.at(-1)).toBe('a00')
  })
})

describe('fetchReceiptUrl', () => {
  it('signs the receipt for an hour', async () => {
    const fake = fakeSupabase().respond('storage:receipts.createSignedUrl', {
      data: { signedUrl: 'https://signed/r.jpg' },
    })

    expect(await fetchReceiptUrl(fake.client, 'g1/r.jpg')).toBe('https://signed/r.jpg')
    expect(fake.storageCalls('receipts')[0]!.args).toEqual(['g1/r.jpg', 3600])
  })

  it('throws receipt_unavailable without a URL, and storage errors as is', async () => {
    const fake = fakeSupabase().respond('storage:receipts.createSignedUrl', { data: {} })
    await expect(fetchReceiptUrl(fake.client, 'g1/r.jpg')).rejects.toThrow('receipt_unavailable')

    const failing = fakeSupabase().respond('storage:receipts.createSignedUrl', { error: boom })
    await expect(fetchReceiptUrl(failing.client, 'g1/r.jpg')).rejects.toBe(boom)
  })
})

describe('expense writes', () => {
  const payload: ExpensePayload = {
    group_id: 'g1',
    description: 'Dinner',
    amount_cents: 3000,
    currency: 'EUR',
    paid_by: 'u1',
    split_type: 'equal',
    splits: [{ user_id: 'u1' }, { user_id: 'u2' }],
    spent_at: '2026-01-01',
  }

  it('creates through create_expense with the payload as is', async () => {
    const fake = fakeSupabase().respond('rpc:create_expense', { data: { id: 'e1' } })
    expect(await createExpense(fake.client, payload)).toEqual({ id: 'e1' })
    expect(fake.rpcArgs('create_expense')).toEqual([{ payload }])
  })

  it('updates, deletes and restores by id', async () => {
    const fake = fakeSupabase()
      .respond('rpc:update_expense', { data: { id: 'e1', description: 'Lunch' } })
      .respond('rpc:delete_expense', { data: { id: 'e1' } })
      .respond('rpc:restore_expense', { data: { id: 'e1' } })
    const { group_id: _g, ...edit } = payload

    await updateExpense(fake.client, 'e1', edit)
    await deleteExpense(fake.client, 'e1')
    await restoreExpense(fake.client, 'e1')

    expect(fake.rpcArgs('update_expense')).toEqual([{ id: 'e1', payload: edit }])
    expect(fake.rpcArgs('delete_expense')).toEqual([{ id: 'e1' }])
    expect(fake.rpcArgs('restore_expense')).toEqual([{ id: 'e1' }])
  })

  it('rethrows the RPC error so callers can read its code', async () => {
    const fake = fakeSupabase().respond('rpc:create_expense', {
      error: { message: 'splits_sum_mismatch' },
    })
    const error = await createExpense(fake.client, payload).catch((e: unknown) => e)
    expect(moneyErrorCode(error)).toBe('splits_sum_mismatch')
  })
})

describe('comments', () => {
  it('adds a comment sending only the expense and the body', async () => {
    const comment = { id: 'c1', expense_id: 'e1', body: 'hi' }
    const fake = fakeSupabase().respond('from:comments', { data: comment })

    expect(await addExpenseComment(fake.client, { expenseId: 'e1', body: 'hi' })).toEqual(comment)
    const [query] = fake.queries('comments')
    expect(argsOf(query!, 'insert')).toEqual([[{ expense_id: 'e1', body: 'hi' }]])
  })

  it('soft deletes a comment', async () => {
    vi.useFakeTimers({ now: new Date('2026-02-03T04:05:06Z') })
    const fake = fakeSupabase().respond('from:comments', { data: null })

    await deleteExpenseComment(fake.client, 'c1')

    const [query] = fake.queries('comments')
    expect(argsOf(query!, 'update')).toEqual([[{ deleted_at: '2026-02-03T04:05:06.000Z' }]])
    expect(argsOf(query!, 'eq')).toEqual([['id', 'c1']])
  })

  it('throws when the delete fails', async () => {
    const fake = fakeSupabase().respond('from:comments', { error: boom })
    await expect(deleteExpenseComment(fake.client, 'c1')).rejects.toBe(boom)
  })
})

describe('settlements', () => {
  it('settles up with only the required arguments', async () => {
    const fake = fakeSupabase().respond('rpc:settle_up', { data: { id: 's1' } })

    expect(
      await settleUp(fake.client, { groupId: 'g1', toUser: 'u2', amountCents: 500, note: null }),
    ).toEqual({ id: 's1' })
    expect(fake.rpcArgs('settle_up')).toEqual([
      { group_id: 'g1', to_user: 'u2', amount_cents: 500 },
    ])
  })

  it('passes currency and note when given', async () => {
    const fake = fakeSupabase().respond('rpc:settle_up', { data: { id: 's1' } })

    await settleUp(fake.client, {
      groupId: 'g1',
      toUser: 'u2',
      amountCents: 500,
      currency: 'USD',
      note: 'cash',
    })

    expect(fake.rpcArgs('settle_up')).toEqual([
      { group_id: 'g1', to_user: 'u2', amount_cents: 500, currency: 'USD', note: 'cash' },
    ])
  })

  it('deletes a settlement by id', async () => {
    const fake = fakeSupabase().respond('rpc:delete_settlement', { data: { id: 's1' } })
    await deleteSettlement(fake.client, 's1')
    expect(fake.rpcArgs('delete_settlement')).toEqual([{ id: 's1' }])
  })
})

describe('recurring expenses', () => {
  it('pauses and deletes templates by id', async () => {
    const fake = fakeSupabase().respond('from:recurring_expenses', { data: null })

    await setRecurringActive(fake.client, 'r1', false)
    await deleteRecurring(fake.client, 'r1')

    const [toggle, remove] = fake.queries('recurring_expenses')
    expect(argsOf(toggle!, 'update')).toEqual([[{ active: false }]])
    expect(argsOf(toggle!, 'eq')).toEqual([['id', 'r1']])
    expect(argsOf(remove!, 'delete')).toHaveLength(1)
    expect(argsOf(remove!, 'eq')).toEqual([['id', 'r1']])
  })

  it('throws write errors', async () => {
    const fake = fakeSupabase().respond('from:recurring_expenses', { error: boom })
    await expect(setRecurringActive(fake.client, 'r1', true)).rejects.toBe(boom)
    await expect(deleteRecurring(fake.client, 'r1')).rejects.toBe(boom)
  })
})

describe('uploadReceipt', () => {
  it('stores the file under the group folder with a cleaned extension', async () => {
    const fake = fakeSupabase()

    const path = await uploadReceipt(fake.client, 'g1', new Uint8Array([1]), {
      extension: '.P-NG',
      contentType: 'image/png',
    })

    expect(path).toMatch(/^g1\/[a-z0-9]+-[a-z0-9]+\.png$/)
    const [upload] = fake.storageCalls('receipts')
    expect(upload!.method).toBe('upload')
    expect(upload!.args[0]).toBe(path)
    expect(upload!.args[2]).toEqual({ contentType: 'image/png', upsert: false })
  })

  it('falls back to jpg when the extension has nothing usable', async () => {
    const fake = fakeSupabase()
    const path = await uploadReceipt(fake.client, 'g1', new Uint8Array(), { extension: '.' })
    expect(path).toMatch(/\.jpg$/)
  })

  it('throws upload errors', async () => {
    const fake = fakeSupabase().respond('storage:receipts.upload', { error: boom })
    await expect(
      uploadReceipt(fake.client, 'g1', new Uint8Array(), { extension: 'jpg' }),
    ).rejects.toBe(boom)
  })
})

describe('moneyQueries', () => {
  it('keys every query under the money namespace and its group or expense', () => {
    const { client } = fakeSupabase()
    expect(moneyQueries.expenses(client, 'g1').queryKey).toEqual(moneyKeys.expenses('g1'))
    expect(moneyKeys.expenses('g1').slice(0, 4)).toEqual(moneyKeys.group('g1'))
    expect(moneyQueries.comments(client, 'e1').queryKey).toEqual([
      'potluck',
      'money',
      'expense',
      'e1',
      'comments',
    ])
    expect(moneyKeys.activity()).toEqual(['potluck', 'money', 'activity'])
  })

  it('caches fx and receipt lookups', () => {
    const { client } = fakeSupabase()
    expect(moneyQueries.fxRate(client, 'EUR', 'USD', '2026-01-01').staleTime).toBe(3_600_000)
    expect(moneyQueries.fxCurrencies(client, 'EUR', '2026-01-01').staleTime).toBe(3_600_000)
    expect(moneyQueries.receiptUrl(client, 'g1/r.jpg').staleTime).toBe(3_000_000)
  })

  it('runs the matching fetcher', async () => {
    const fake = fakeSupabase({ user: { id: 'u1' } })
      .respond('from:profiles', { data: [] })
      .respond('from:groups', { data: { id: 'g1', group_members: [] } })
      .respond('from:group_balances', { data: [] })
      .respond('rpc:simplified_debts', { data: [] })
      .respond('from:expenses', { data: [] })
      .respond('from:settlements', { data: [] })
      .respond('from:recurring_expenses', { data: [] })
      .respond('from:comments', { data: [] })
      .respond('from:fx_rates', { data: [] })
      .respond('storage:receipts.createSignedUrl', { data: { signedUrl: 'u' } })
    const { client } = fake
    const run = (o: { queryFn?: unknown }) => (o.queryFn as () => Promise<unknown>)()

    await run(moneyQueries.people(client))
    await run(moneyQueries.group(client, 'g1'))
    await run(moneyQueries.expenses(client, 'g1'))
    await run(moneyQueries.settlements(client, 'g1'))
    await run(moneyQueries.balances(client, 'g1'))
    await run(moneyQueries.simplified(client, 'g1'))
    await run(moneyQueries.recurring(client, 'g1'))
    await run(moneyQueries.expense(client, 'e1'))
    await run(moneyQueries.comments(client, 'e1'))
    await run(moneyQueries.fxRate(client, 'EUR', 'USD', '2026-01-01'))
    await run(moneyQueries.fxCurrencies(client, 'EUR', '2026-01-01'))
    expect(await run(moneyQueries.receiptUrl(client, 'g1/r.jpg'))).toBe('u')

    expect(fake.queries().map((q) => q.table)).toEqual([
      'profiles',
      'groups',
      'expenses',
      'settlements',
      'group_balances',
      'recurring_expenses',
      'expenses',
      'comments',
      'fx_rates',
      'fx_rates',
      'fx_rates',
    ])
    expect(fake.rpcArgs('simplified_debts')).toEqual([{ group_id: 'g1' }])
  })

  it('lists groups through myGroups', async () => {
    const fake = fakeSupabase().respond('from:groups', { data: [] })
    const options = moneyQueries.myGroups(fake.client)
    expect(await (options.queryFn as () => Promise<unknown>)()).toEqual([])
  })
})
