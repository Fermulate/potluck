import type { NotificationRow } from '@potluck/api'
import { describe, expect, it } from 'vitest'
import { describeNotification } from './describe'

const ctx = {
  people: new Map([['u-ben', 'Ben Ortiz']]),
  groups: new Map([['g-1', 'Hike crew']]),
  timeZone: 'America/New_York',
}

function row(type: string, data: Record<string, unknown>): NotificationRow {
  return {
    id: 'n1',
    user_id: 'me',
    type,
    data: data as NotificationRow['data'],
    read_at: null,
    channels: [],
    created_at: '2026-11-05T12:00:00Z',
  }
}

describe('describeNotification', () => {
  it('names the actor and group for a new expense and links to it', () => {
    const view = describeNotification(
      row('expense.created', {
        actor_id: 'u-ben',
        group_id: 'g-1',
        expense_id: 'e-9',
        description: 'Trail snacks',
        amount_cents: 2450,
        currency: 'USD',
      }),
      ctx,
    )
    expect(view.title).toBe('New expense in Hike crew')
    expect(view.body).toBe('Ben added Trail snacks: $24.50')
    expect(view.target).toEqual({ to: '/expenses/$expenseId', params: { expenseId: 'e-9' } })
  })

  describe("settlements, from the reader's side of the payment", () => {
    const people = new Map([
      ['u-ben', 'Ben Ortiz'],
      ['u-cleo', 'Cleo Park'],
      ['u-ava', 'Ava Chen'],
    ])
    const payment = (actor_id: string) =>
      row('settlement.created', {
        actor_id,
        group_id: 'g-1',
        from_user: 'u-ben',
        to_user: 'u-cleo',
        amount_cents: 1000,
        currency: 'USD',
      })

    it('tells the payee who paid them and links to the balances', () => {
      const view = describeNotification(
        { ...payment('u-ben'), user_id: 'u-cleo' },
        { ...ctx, people },
      )
      expect(view.title).toBe('You got paid')
      expect(view.body).toBe('Ben paid you $10.00')
      expect(view.target).toEqual({ to: '/groups/$groupId/balances', params: { groupId: 'g-1' } })
    })

    it('tells the payer their payment was marked received when the payee recorded it', () => {
      const view = describeNotification(
        { ...payment('u-cleo'), user_id: 'u-ben' },
        { ...ctx, people },
      )
      expect(view.title).toBe('Payment recorded')
      expect(view.body).toBe('Cleo marked your $10.00 payment as received')
    })

    it('names who recorded it when a third member logged the payment', () => {
      const asPayer = describeNotification(
        { ...payment('u-ava'), user_id: 'u-ben' },
        { ...ctx, people },
      )
      expect(asPayer.body).toBe('Ava recorded your $10.00 payment to Cleo')
      const asPayee = describeNotification(
        { ...payment('u-ava'), user_id: 'u-cleo' },
        { ...ctx, people },
      )
      expect(asPayee.body).toBe('Ben paid you $10.00')
    })
  })

  it('opens the plan for availability requests', () => {
    const view = describeNotification(
      row('availability.requested', {
        actor_id: 'u-ben',
        event_id: 'ev-1',
        event_title: 'Sunrise hike',
      }),
      ctx,
    )
    expect(view.body).toBe('Ben needs your availability for Sunrise hike')
    expect(view.target).toEqual({ to: '/plans/$eventId', params: { eventId: 'ev-1' } })
  })

  it('falls back to neutral words when people or groups are unknown', () => {
    const view = describeNotification(
      row('member.joined', { actor_id: 'u-x', group_id: 'g-x' }),
      ctx,
    )
    expect(view.title).toBe('New face in your group')
    expect(view.body).toBe('Someone just joined. Say hi.')
    expect(view.target).toEqual({ to: '/groups/$groupId/members', params: { groupId: 'g-x' } })
  })

  it('handles types it does not know yet', () => {
    const view = describeNotification(row('something.new', {}), ctx)
    expect(view.kind).toBe('other')
    expect(view.target).toEqual({ to: '/notifications' })
  })
})

describe('deletions, being added, and the monthly summary', () => {
  it('says who deleted or restored an expense and still links to it', () => {
    const data = { actor_id: 'u-ben', group_id: 'g-1', expense_id: 'e-9', description: 'Gas' }
    const deleted = describeNotification(row('expense.deleted', data), ctx)
    expect(deleted.title).toBe('Expense deleted')
    expect(deleted.body).toBe('Ben deleted Gas in Hike crew')
    expect(deleted.target).toEqual({ to: '/expenses/$expenseId', params: { expenseId: 'e-9' } })
    expect(describeNotification(row('expense.restored', data), ctx).body).toBe(
      'Ben brought back Gas in Hike crew',
    )
  })

  it('welcomes someone added to a group and opens it', () => {
    const view = describeNotification(
      row('member.added', { actor_id: 'u-ben', group_id: 'g-1' }),
      ctx,
    )
    expect(view.title).toBe('Welcome to Hike crew')
    expect(view.body).toBe('Ben added you. Pull up a chair.')
    expect(view.kind).toBe('people')
    expect(view.target).toEqual({ to: '/groups/$groupId', params: { groupId: 'g-1' } })
  })

  it('sums up the month: the two biggest balances, then a count of the rest', () => {
    const view = describeNotification(
      row('summary.monthly', {
        month: '2026-10-01',
        groups: [
          { group_id: 'g-1', name: 'Old name', currency: 'USD', net_cents: 1250 },
          { group_id: 'g-2', name: 'Tokyo', currency: 'JPY', net_cents: -4500 },
          { group_id: 'g-3', name: 'Books', currency: 'EUR', net_cents: 0 },
          { group_id: 'g-4', name: 'Rent', currency: 'USD', net_cents: -100 },
          { group_id: 'g-5', name: 'Gym', currency: 'USD', net_cents: 300 },
        ],
      }),
      ctx,
    )
    expect(view.title).toBe('Your month in Potluck')
    expect(view.body).toBe(
      'Hike crew: you are owed $12.50, Tokyo: you owe ¥4,500 and 2 more groups',
    )
    expect(view.kind).toBe('summary')
    expect(view.target).toEqual({ to: '/home' })
  })

  it('a month where everything is settled says so', () => {
    expect(describeNotification(row('summary.monthly', { groups: [] }), ctx).body).toBe(
      'All settled up. Nice work.',
    )
    expect(describeNotification(row('summary.monthly', {}), ctx).body).toBe(
      'All settled up. Nice work.',
    )
    expect(
      describeNotification(
        row('summary.monthly', {
          groups: [{ name: 'Solo', currency: 'USD', net_cents: 500 }, null],
        }),
        ctx,
      ).body,
    ).toBe('Solo: you are owed $5.00')
  })
})
