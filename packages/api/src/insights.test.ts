import { describe, expect, it } from 'vitest'
import {
  deletedItemsInfiniteQueryOptions,
  fetchSpendingSummary,
  insightsKeys,
  insightsQueries,
  DELETED_PAGE_SIZE,
  fetchDeletedItems,
  SEARCH_PAGE_SIZE,
  searchInfiniteQueryOptions,
  searchMoney,
  type SearchHit,
} from './insights'
import { fetchActivity, activityInfiniteQueryOptions, moneyKeys } from './money'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

/** Runs an infinite query's first page. */
const firstPage = (options: { queryFn?: unknown }) =>
  (options.queryFn as (ctx: { pageParam: undefined }) => Promise<unknown[]>)({
    pageParam: undefined,
  })

const searchRow = {
  kind: 'expense',
  id: 'e1',
  group_id: 'g1',
  day: '2026-03-05',
  at: '2026-03-05T10:00:00+00:00',
  description: 'Taco night',
  category: 'food',
  amount_cents: 9000,
  currency: 'USD',
  group_currency: 'USD',
  group_amount_cents: 9000,
  paid_by: 'u1',
  to_user: null,
  created_by: 'u1',
  my_paid_cents: 9000,
  my_share_cents: 3000,
  deleted_at: null,
  matched: 'description',
  snippet: null,
  payers: ['u1'],
  is_refund: false,
}

describe('searchMoney', () => {
  it('sends only the filters that are set and maps rows', async () => {
    const fake = fakeSupabase().respond('rpc:search_money', { data: [searchRow] })

    const hits = await searchMoney(fake.client, {
      query: '  taco ',
      groupId: 'g1',
      person: 'u2',
      from: '2026-03-01',
      to: '2026-03-31',
      categories: ['groceries', 'food'],
      kinds: ['expense'],
    })

    expect(fake.rpcArgs('search_money')).toEqual([
      {
        max_rows: SEARCH_PAGE_SIZE,
        query: 'taco',
        in_group: 'g1',
        person: 'u2',
        from_day: '2026-03-01',
        to_day: '2026-03-31',
        categories: ['food', 'dining_out', 'takeout', 'coffee', 'snacks', 'groceries'],
        kinds: ['expense'],
      },
    ])
    expect(hits).toEqual<SearchHit[]>([
      {
        kind: 'expense',
        id: 'e1',
        groupId: 'g1',
        day: '2026-03-05',
        at: '2026-03-05T10:00:00+00:00',
        description: 'Taco night',
        category: 'food',
        amountCents: 9000,
        currency: 'USD',
        groupCurrency: 'USD',
        groupAmountCents: 9000,
        paidBy: 'u1',
        toUser: null,
        createdBy: 'u1',
        myPaidCents: 9000,
        myShareCents: 3000,
        deletedAt: null,
        matched: 'description',
        snippet: null,
        payers: ['u1'],
        isRefund: false,
      },
    ])
  })

  it('pages with a cursor and ignores a blank query', async () => {
    const fake = fakeSupabase().respond('rpc:search_money', { data: null })

    expect(
      await searchMoney(
        fake.client,
        { query: '   ' },
        { before: { day: '2026-03-05', at: 'x', id: 'e1' }, limit: 5 },
      ),
    ).toEqual([])
    expect(fake.rpcArgs('search_money')).toEqual([
      { max_rows: 5, before_day: '2026-03-05', before_at: 'x', before_id: 'e1' },
    ])
  })

  it('throws the database error as is', async () => {
    const error = { message: 'invalid_date_range' }
    const fake = fakeSupabase().respond('rpc:search_money', { error })
    await expect(searchMoney(fake.client, {})).rejects.toBe(error)
  })
})

describe('search query options', () => {
  it('keys on the normalized filters', () => {
    expect(insightsKeys.search({ query: ' a ', categories: ['b', 'a'] })).toEqual(
      insightsKeys.search({ query: 'a', categories: ['a', 'b'], kinds: [] }),
    )
  })

  it('continues after the last row of a full page, and stops after a short one', async () => {
    const fake = fakeSupabase().respond('rpc:search_money', { data: [searchRow] })
    const options = searchInfiniteQueryOptions(fake.client, { query: 'taco' })
    const full = Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => ({
      ...({} as SearchHit),
      day: '2026-03-01',
      at: 't',
      id: `e${i}`,
    }))
    expect(options.getNextPageParam(full, [full], undefined, [undefined])).toEqual({
      day: '2026-03-01',
      at: 't',
      id: `e${SEARCH_PAGE_SIZE - 1}`,
    })
    expect(options.getNextPageParam([], [[]], undefined, [undefined])).toBeUndefined()
    const page = await firstPage(options)
    expect(page).toHaveLength(1)
  })
})

describe('deleted items', () => {
  const deletedRow = {
    kind: 'payment',
    id: 's1',
    group_id: 'g1',
    day: '2026-03-05',
    description: 'Venmo',
    category: null,
    amount_cents: 3000,
    currency: 'USD',
    paid_by: 'u1',
    to_user: 'u2',
    created_by: 'u1',
    deleted_at: '2026-03-06T10:00:00+00:00',
    deleted_by: 'u2',
  }

  it('lists them under the group money key, with who deleted each', async () => {
    const fake = fakeSupabase().respond('rpc:deleted_items', { data: [deletedRow] })
    const options = deletedItemsInfiniteQueryOptions(fake.client, 'g1')
    expect(options.queryKey.slice(0, 4)).toEqual(moneyKeys.group('g1'))
    expect(await firstPage(options)).toEqual([
      expect.objectContaining({ kind: 'payment', toUser: 'u2', deletedBy: 'u2' }),
    ])
    expect(fake.rpcArgs('deleted_items')).toEqual([{ in_group: 'g1', max_rows: DELETED_PAGE_SIZE }])
  })

  it('pages by deletion time', async () => {
    const fake = fakeSupabase().respond('rpc:deleted_items', { data: null })
    expect(
      await fetchDeletedItems(fake.client, 'g1', {
        before: { deletedAt: '2026-03-06T10:00:00+00:00', id: 's1' },
        limit: 2,
      }),
    ).toEqual([])
    expect(fake.rpcArgs('deleted_items')).toEqual([
      { in_group: 'g1', max_rows: 2, before_at: '2026-03-06T10:00:00+00:00', before_id: 's1' },
    ])
    const { getNextPageParam } = deletedItemsInfiniteQueryOptions(fake.client, 'g1')
    const full = Array.from({ length: DELETED_PAGE_SIZE }, (_, i) => ({
      deletedAt: `t${i}`,
      id: `x${i}`,
    })) as never[]
    expect(getNextPageParam(full, [full], undefined, [undefined])).toEqual({
      deletedAt: `t${DELETED_PAGE_SIZE - 1}`,
      id: `x${DELETED_PAGE_SIZE - 1}`,
    })
    expect(getNextPageParam([], [[]], undefined, [undefined])).toBeUndefined()
  })
})

describe('fetchSpendingSummary', () => {
  const summaryRow = {
    group_id: 'g1',
    currency: 'USD',
    month: '2026-03-01',
    category: 'food',
    expense_count: 1,
    spend_cents: 9000,
    paid_cents: 9000,
    share_cents: 3000,
    payments_made_cents: 0,
    payments_received_cents: 0,
    unconverted_count: 0,
  }

  it('maps rows and passes the range', async () => {
    const fake = fakeSupabase().respond('rpc:spending_summary', { data: [summaryRow] })
    expect(
      await fetchSpendingSummary(fake.client, {
        groupId: 'g1',
        from: '2026-03-01',
        to: '2026-03-31',
      }),
    ).toEqual([
      {
        groupId: 'g1',
        currency: 'USD',
        month: '2026-03-01',
        category: 'food',
        expenseCount: 1,
        spendCents: 9000,
        paidCents: 9000,
        shareCents: 3000,
        paymentsMadeCents: 0,
        paymentsReceivedCents: 0,
        unconvertedCount: 0,
      },
    ])
    expect(fake.rpcArgs('spending_summary')).toEqual([
      { in_group: 'g1', from_day: '2026-03-01', to_day: '2026-03-31' },
    ])
  })

  it('pages past the row cap', async () => {
    const page = Array.from({ length: 1000 }, () => summaryRow)
    const fake = fakeSupabase().respond(
      'rpc:spending_summary',
      { data: page },
      { data: [summaryRow] },
    )
    expect(await fetchSpendingSummary(fake.client)).toHaveLength(1001)
    expect(fake.calls.map((c) => (c.kind === 'rpc' ? c.range : null))).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(fake.rpcArgs('spending_summary')[0]).toEqual({})
  })

  it('has query options per group (under the group money key) and across groups', async () => {
    const fake = fakeSupabase().respond('rpc:spending_summary', { data: [] })
    const group = insightsQueries.groupSpending(fake.client, 'g1')
    expect(group.queryKey.slice(0, 4)).toEqual(moneyKeys.group('g1'))
    const all = insightsQueries.spending(fake.client, '2026-01-01', '2026-12-31', 'EUR')
    expect(all.queryKey).toEqual(insightsKeys.spending('2026-01-01', '2026-12-31', 'EUR'))
    const run = (q: { queryFn?: unknown }) => (q.queryFn as () => Promise<unknown>)()
    await run(group)
    await run(all)
    expect(fake.rpcArgs('spending_summary')).toEqual([
      { in_group: 'g1' },
      { from_day: '2026-01-01', to_day: '2026-12-31', in_currency: 'EUR' },
    ])
  })
})

describe('activity filters', () => {
  it('narrows the feed to a group', async () => {
    const fake = fakeSupabase().respond('from:activity', { data: [] })
    await fetchActivity(fake.client, { groupId: 'g1' })
    const [byGroup] = fake.queries('activity')
    expect(argsOf(byGroup!, 'eq')).toEqual([['group_id', 'g1']])
  })

  it('reads what involves a friend through friend_activity, shaped like the feed', async () => {
    const fake = fakeSupabase().respond('rpc:friend_activity', {
      data: [
        {
          id: 'a1',
          group_id: 'g1',
          actor_id: 'u2',
          verb: 'settlement.created',
          subject_id: 's1',
          data: null,
          created_at: '2026-03-06T10:00:00+00:00',
          actor_info: { id: 'u2', display_name: 'Fay', avatar_path: null },
          group_info: { id: 'g1', name: 'Direct', emoji: null, is_direct: true },
        },
      ],
    })
    expect(
      await fetchActivity(fake.client, {
        friendId: 'u2',
        before: { createdAt: 't', id: 'a0' },
        limit: 5,
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'a1',
        data: {},
        actor: { id: 'u2', display_name: 'Fay', avatar_path: null },
        group: { id: 'g1', name: 'Direct', emoji: null, is_direct: true },
      }),
    ])
    expect(fake.rpcArgs('friend_activity')).toEqual([
      { friend: 'u2', max_rows: 5, before_at: 't', before_id: 'a0' },
    ])
    expect(fake.queries('activity')).toEqual([])
    const fakeEmpty = fakeSupabase().respond('rpc:friend_activity', { data: null })
    expect(await fetchActivity(fakeEmpty.client, { friendId: 'u2' })).toEqual([])
  })

  it('keeps filtered feeds under the activity key', () => {
    const fake = fakeSupabase()
    expect(activityInfiniteQueryOptions(fake.client).queryKey).toEqual(moneyKeys.activity())
    expect(activityInfiniteQueryOptions(fake.client, { groupId: 'g1' }).queryKey).toEqual([
      ...moneyKeys.activity(),
      { groupId: 'g1', friendId: undefined },
    ])
  })
})
