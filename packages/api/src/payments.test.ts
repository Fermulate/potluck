import { describe, expect, it } from 'vitest'
import {
  addPaymentComment,
  fetchFriendBalances,
  fetchPaymentComments,
  fetchPaymentMethods,
  fetchRemindersSent,
  fetchSettlement,
  paymentKeys,
  paymentQueries,
  recordPayment,
  remindDebt,
  removePaymentMethod,
  restoreSettlement,
  savePaymentMethod,
  settleAll,
  settleWithFriend,
  updateSettlement,
} from './index'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_allowed' }

describe('recordPayment', () => {
  it('sends only the arguments given', async () => {
    const fake = fakeSupabase().respond('rpc:settle_up_v2', { data: { id: 's1' } })
    expect(
      await recordPayment(fake.client, {
        groupId: 'g1',
        fromUser: 'b',
        toUser: 'a',
        amountCents: 2000,
      }),
    ).toEqual({ id: 's1' })
    await recordPayment(fake.client, {
      groupId: 'g1',
      fromUser: 'b',
      toUser: 'a',
      amountCents: 2000,
      currency: 'EUR',
      note: 'cash',
      settledOn: '2026-10-13',
    })
    expect(fake.rpcArgs('settle_up_v2')).toEqual([
      { group_id: 'g1', from_user: 'b', to_user: 'a', amount_cents: 2000 },
      {
        group_id: 'g1',
        from_user: 'b',
        to_user: 'a',
        amount_cents: 2000,
        currency: 'EUR',
        note: 'cash',
        settled_on: '2026-10-13',
      },
    ])
  })

  it('throws the server error as is', async () => {
    const fake = fakeSupabase().respond('rpc:settle_up_v2', { error: boom })
    await expect(
      recordPayment(fake.client, { groupId: 'g1', fromUser: 'b', toUser: 'a', amountCents: 1 }),
    ).rejects.toBe(boom)
  })
})

describe('updateSettlement', () => {
  it('sends the keys that change, and null to clear the note', async () => {
    const fake = fakeSupabase().respond('rpc:update_settlement', { data: { id: 's1' } })
    await updateSettlement(fake.client, 's1', { amountCents: 2500, note: null })
    await updateSettlement(fake.client, 's1', {
      fromUser: 'a',
      toUser: 'b',
      currency: 'EUR',
      settledOn: '2026-11-01',
    })
    expect(fake.rpcArgs('update_settlement')).toEqual([
      { id: 's1', payload: { amount_cents: 2500, note: null } },
      {
        id: 's1',
        payload: { from_user: 'a', to_user: 'b', currency: 'EUR', settled_on: '2026-11-01' },
      },
    ])
  })
})

describe('restore, bulk settle and reminders', () => {
  it('calls each RPC with its arguments', async () => {
    const fake = fakeSupabase()
      .respond('rpc:restore_settlement', { data: { id: 's1' } })
      .respond('rpc:settle_all', { data: [{ id: 's2' }] })
      .respond('rpc:settle_with_friend', { data: [{ id: 's3' }, { id: 's4' }] })
      .respond('rpc:remind_debt', { data: { id: 'r1' } })

    expect(await restoreSettlement(fake.client, 's1')).toEqual({ id: 's1' })
    expect(await settleAll(fake.client, 'g1')).toEqual([{ id: 's2' }])
    await settleAll(fake.client, 'g1', { settledOn: '2026-11-01', note: 'square' })
    expect(await settleWithFriend(fake.client, 'b')).toHaveLength(2)
    await settleWithFriend(fake.client, 'b', { settledOn: '2026-11-01', note: 'all of it' })
    await settleWithFriend(fake.client, 'b', { amounts: { g1: 200 } })
    expect(await remindDebt(fake.client, 'g1', 'b')).toEqual({ id: 'r1' })
    await remindDebt(fake.client, 'g1', 'b', '  Rent is due  ')
    await remindDebt(fake.client, 'g1', 'b', '   ')

    expect(fake.rpcArgs('restore_settlement')).toEqual([{ id: 's1' }])
    expect(fake.rpcArgs('settle_all')).toEqual([
      { group_id: 'g1' },
      { group_id: 'g1', settled_on: '2026-11-01', note: 'square' },
    ])
    expect(fake.rpcArgs('settle_with_friend')).toEqual([
      { friend_id: 'b' },
      { friend_id: 'b', settled_on: '2026-11-01', note: 'all of it' },
      { friend_id: 'b', amounts: { g1: 200 } },
    ])
    expect(fake.rpcArgs('remind_debt')).toEqual([
      { group_id: 'g1', user_id: 'b' },
      { group_id: 'g1', user_id: 'b', note: 'Rent is due' },
      { group_id: 'g1', user_id: 'b' },
    ])
  })
})

describe('reads', () => {
  it('fetches one payment, deleted ones included', async () => {
    const fake = fakeSupabase({ tables: { settlements: [{ id: 's1', deleted_at: 'x' }] } })
    expect(await fetchSettlement(fake.client, 's1')).toEqual({ id: 's1', deleted_at: 'x' })
    expect(argsOf(fake.queries('settlements')[0]!, 'select')[0]![0]).toContain('fx_rate::text')
  })

  it('reads live comments on a payment, oldest first', async () => {
    const fake = fakeSupabase({
      tables: {
        comments: [
          { id: 'c2', settlement_id: 's1', deleted_at: null, created_at: '2026-01-02' },
          { id: 'c1', settlement_id: 's1', deleted_at: null, created_at: '2026-01-01' },
          { id: 'c3', settlement_id: 's1', deleted_at: '2026-01-03', created_at: '2026-01-03' },
          { id: 'c4', settlement_id: 's2', deleted_at: null, created_at: '2026-01-01' },
        ],
      },
    })
    expect((await fetchPaymentComments(fake.client, 's1')).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('maps friend balances to the core shape', async () => {
    const fake = fakeSupabase().respond('rpc:friend_balances', {
      data: [{ friend_id: 'b', group_id: 'g1', currency: 'USD', net_cents: -500, archived: false }],
    })
    expect(await fetchFriendBalances(fake.client)).toEqual([
      { friendId: 'b', groupId: 'g1', currency: 'USD', netCents: -500, archived: false },
    ])
    const empty = fakeSupabase().respond('rpc:friend_balances', { data: null })
    expect(await fetchFriendBalances(empty.client)).toEqual([])
  })

  it("reads someone's payment methods and today's reminders", async () => {
    const fake = fakeSupabase({
      tables: {
        payment_methods: [
          { user_id: 'a', kind: 'venmo', handle: 'ava-lee' },
          { user_id: 'a', kind: 'paypal', handle: 'avamakes' },
          { user_id: 'b', kind: 'paypal', handle: 'ben' },
        ],
        debt_reminders: [
          { id: 'r1', group_id: 'g1', from_user: 'a', to_user: 'b', sent_on: '2026-11-13' },
          { id: 'r2', group_id: 'g1', from_user: 'a', to_user: 'c', sent_on: '2026-11-12' },
        ],
      },
    })
    expect((await fetchPaymentMethods(fake.client, 'a')).map((m) => m.kind)).toEqual([
      'paypal',
      'venmo',
    ])
    expect(
      (await fetchRemindersSent(fake.client, 'g1', 'a', '2026-11-13')).map((r) => r.id),
    ).toEqual(['r1'])
  })
})

describe('writes', () => {
  it('adds a payment comment with the payment id and body only', async () => {
    const fake = fakeSupabase().respond('from:comments', { data: { id: 'c1' } })
    await addPaymentComment(fake.client, { settlementId: 's1', body: 'Thanks!' })
    expect(argsOf(fake.queries('comments')[0]!, 'insert')).toEqual([
      [{ settlement_id: 's1', body: 'Thanks!' }],
    ])
  })

  it('upserts one handle per app and removes your own', async () => {
    const fake = fakeSupabase().respond('from:payment_methods', {
      data: { kind: 'paypal', handle: 'avamakes' },
    })
    await savePaymentMethod(fake.client, { kind: 'paypal', handle: 'avamakes' })
    await removePaymentMethod(fake.client, 'a', 'paypal')
    const [save, remove] = fake.queries('payment_methods')
    expect(argsOf(save!, 'upsert')).toEqual([
      [{ kind: 'paypal', handle: 'avamakes' }, { onConflict: 'user_id,kind' }],
    ])
    expect(argsOf(remove!, 'eq')).toEqual([
      ['user_id', 'a'],
      ['kind', 'paypal'],
    ])
  })

  it('throws write errors as is', async () => {
    const fake = fakeSupabase().respond('from:payment_methods', { error: boom })
    await expect(savePaymentMethod(fake.client, { kind: 'paypal', handle: 'x' })).rejects.toBe(boom)
    await expect(removePaymentMethod(fake.client, 'a', 'paypal')).rejects.toBe(boom)
  })
})

describe('paymentQueries', () => {
  it('keys payments under money and friend balances under groups', async () => {
    const fake = fakeSupabase()
      .respond('rpc:friend_balances', { data: [] })
      .respond('from:settlements', { data: { id: 's1' } })
      .respond('from:comments', { data: [] })
      .respond('from:payment_methods', { data: [] })
      .respond('from:debt_reminders', { data: [] })
    const settlement = paymentQueries.settlement(fake.client, 's1')
    expect(settlement.queryKey).toEqual(['potluck', 'money', 'settlement', 's1'])
    expect(paymentQueries.friendBalances(fake.client).queryKey).toEqual(
      paymentKeys.friendBalances(),
    )
    expect(paymentKeys.friendBalances()[1]).toBe('groups')
    const run = <T>(q: { queryFn?: unknown }) => (q.queryFn as (ctx: unknown) => Promise<T>)({})
    expect(await run(settlement)).toEqual({ id: 's1' })
    expect(await run(paymentQueries.comments(fake.client, 's1'))).toEqual([])
    expect(await run(paymentQueries.friendBalances(fake.client))).toEqual([])
    expect(await run(paymentQueries.methods(fake.client, 'a'))).toEqual([])
    expect(await run(paymentQueries.reminders(fake.client, 'g1', 'a', '2026-11-13'))).toEqual([])
    expect(paymentKeys.reminders('g1')).toEqual(['potluck', 'money', 'group', 'g1', 'reminders'])
  })
})
