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
