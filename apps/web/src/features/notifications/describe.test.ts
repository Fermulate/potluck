import type { NotificationRow } from '@potluck/api'
import { formatDate, formatTime } from '@potluck/i18n'
import { describe, expect, it } from 'vitest'
import { describeNotification, notificationGroupName } from './describe'

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

  it('says what a new expense means for the reader, Splitwise style', () => {
    const dinner = {
      actor_id: 'u-ben',
      group_id: 'g-1',
      expense_id: 'e-9',
      description: 'Dinner',
      amount_cents: 9000,
      currency: 'USD',
      paid_by: 'u-ben',
    }
    // In the split, paid nothing.
    expect(
      describeNotification(
        row('expense.created', { ...dinner, share_cents: 3000, paid_cents: 0 }),
        ctx,
      ).body,
    ).toBe('Ben added Dinner: $90.00. You owe $30.00.')
    // One of two payers: paid 60, share 30.
    expect(
      describeNotification(
        row('expense.created', { ...dinner, share_cents: 3000, paid_cents: 6000 }),
        ctx,
      ).body,
    ).toBe('Ben added Dinner: $90.00. You get back $30.00.')
    // Older rows without paid_cents cannot tell who paid what: just the expense.
    expect(
      describeNotification(
        row('expense.created', { ...dinner, paid_by: 'me', share_cents: 3000 }),
        ctx,
      ).body,
    ).toBe('Ben added Dinner: $90.00')
    // Square, or no share at all: just the expense.
    expect(
      describeNotification(
        row('expense.created', { ...dinner, share_cents: 0, paid_cents: 0 }),
        ctx,
      ).body,
    ).toBe('Ben added Dinner: $90.00')
  })

  it('marks refunds and turns the line around for them', () => {
    const refund = {
      actor_id: 'u-ben',
      group_id: 'g-1',
      expense_id: 'e-7',
      description: 'Returned tickets',
      amount_cents: 3000,
      currency: 'USD',
      is_refund: true,
    }
    // The refund went to the reader, so they hold the others' part.
    const toMe = describeNotification(
      row('expense.created', { ...refund, share_cents: 1500, paid_cents: 3000 }),
      ctx,
    )
    expect(toMe.title).toBe('Refund in Hike crew')
    expect(toMe.body).toBe('Ben added Returned tickets: $30.00. You owe $15.00.')
    expect(
      describeNotification(
        row('expense.created', { ...refund, share_cents: 1500, paid_cents: 0 }),
        ctx,
      ).body,
    ).toBe('Ben added Returned tickets: $30.00. You get back $15.00.')
    for (const [type, title] of [
      ['expense.updated', 'Refund updated'],
      ['expense.deleted', 'Refund deleted'],
      ['expense.restored', 'Refund restored'],
    ] as const) {
      expect(describeNotification(row(type, refund), ctx).title).toBe(title)
    }
  })

  it('links payment changes and payment comments to the payment', () => {
    for (const [type, title] of [
      ['settlement.updated', 'Payment changed'],
      ['settlement.deleted', 'Payment deleted'],
      ['settlement.restored', 'Payment restored'],
    ] as const) {
      const view = describeNotification(
        row(type, {
          actor_id: 'u-ben',
          group_id: 'g-1',
          settlement_id: 's-1',
          amount_cents: 1000,
          currency: 'USD',
        }),
        ctx,
      )
      expect(view.title).toBe(title)
      expect(view.body).toContain('Ben')
      expect(view.body).toContain('$10.00 payment in Hike crew')
      expect(view.target).toEqual({ to: '/payments/$paymentId', params: { paymentId: 's-1' } })
    }
    const comment = describeNotification(
      row('comment.created', { actor_id: 'u-ben', settlement_id: 's-1', excerpt: 'Thanks' }),
      ctx,
    )
    expect(comment.target).toEqual({ to: '/payments/$paymentId', params: { paymentId: 's-1' } })
  })

  it('turns a reminder into a nudge that opens settle up with them picked', () => {
    const view = describeNotification(
      row('debt.reminder', {
        actor_id: 'u-ben',
        from_user: 'u-ben',
        group_id: 'g-1',
        amount_cents: 2500,
        currency: 'USD',
      }),
      ctx,
    )
    expect(view.title).toBe('A friendly nudge')
    expect(view.body).toBe('Ben says you owe $25.00 in Hike crew')
    expect(
      describeNotification(
        row('debt.reminder', {
          actor_id: 'u-ben',
          group_id: 'g-1',
          amount_cents: 2500,
          currency: 'USD',
          note: 'Rent is due',
        }),
        ctx,
      ).body,
    ).toBe('Ben says you owe $25.00 in Hike crew: "Rent is due"')
    expect(view.kind).toBe('payment')
    expect(view.target).toEqual({ to: '/new/settle', search: { groupId: 'g-1', to: 'u-ben' } })
    expect(describeNotification(row('debt.reminder', {}), ctx).target).toEqual({
      to: '/notifications',
    })
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

  it('warns that a recovery code turned two-step sign in off and opens Me', () => {
    const view = describeNotification(row('account.mfa_removed', {}), ctx)
    expect(view.title).toBe('Two-step sign in is off')
    expect(view.body).toMatch(/change your password/)
    expect(view.target).toEqual({ to: '/me' })
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

  it('opens a new friend from an accepted friend link', () => {
    const view = describeNotification(
      row('friend.added', { actor_id: 'u-ben', user_id: 'u-ben' }),
      ctx,
    )
    expect(view.title).toBe('New friend')
    expect(view.body).toBe('Ben accepted your friend link.')
    expect(view.target).toEqual({ to: '/friends/$friendId', params: { friendId: 'u-ben' } })
    expect(describeNotification(row('friend.added', {}), ctx).target).toEqual({ to: '/friends' })
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

  it('says a group was deleted, by its stored name, and opens the page that restores it', () => {
    const view = describeNotification(
      row('group.deleted', { actor_id: 'u-ben', deleted_group_id: 'g-9', group_name: 'Old flat' }),
      ctx,
    )
    expect(view.title).toBe('Old flat was deleted')
    expect(view.kind).toBe('removed')
    expect(view.body).toBe('Ben deleted it. Anyone in it can bring it back for 30 days.')
    expect(view.target).toEqual({ to: '/groups/$groupId', params: { groupId: 'g-9' } })
    expect(describeNotification(row('group.deleted', {}), ctx).target).toEqual({
      to: '/notifications',
    })
  })

  it('says a group is back and opens it', () => {
    const view = describeNotification(
      row('group.restored', { actor_id: 'u-ben', group_id: 'g-1', group_name: 'Hike crew' }),
      ctx,
    )
    expect(view.title).toBe('Hike crew is back')
    expect(view.body).toBe('Ben brought it back.')
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

describe('one-on-one tabs', () => {
  const tab = {
    id: 'g-tab',
    name: 'Direct',
    is_direct: true,
    members: [
      { id: 'me', display_name: 'Pat Lee' },
      { id: 'u-owen', display_name: 'Owen Owner' },
    ],
  }

  it('are named after the friend inside a sentence, never by their stored name', () => {
    expect(notificationGroupName(tab, 'me')).toBe('your tab with Owen')
    expect(notificationGroupName({ ...tab, members: [tab.members[0]!] }, 'me')).toBe('your group')
    expect(notificationGroupName({ ...tab, name: 'Hike crew', is_direct: false }, 'me')).toBe(
      'Hike crew',
    )
    const view = describeNotification(
      row('expense.created', {
        actor_id: 'u-ben',
        group_id: 'g-tab',
        expense_id: 'e-1',
        description: 'Rent',
        amount_cents: 50000,
        currency: 'USD',
      }),
      { ...ctx, groups: new Map([['g-tab', notificationGroupName(tab, 'me')]]) },
    )
    expect(view.title).toBe('New expense in your tab with Owen')
  })

  it('keep the friend name the monthly summary gives them', () => {
    const view = describeNotification(
      row('summary.monthly', {
        groups: [
          {
            group_id: 'g-tab',
            name: 'Owen Owner',
            is_direct: true,
            currency: 'USD',
            net_cents: 500,
          },
        ],
      }),
      { ...ctx, groups: new Map([['g-tab', 'your tab with Owen']]) },
    )
    expect(view.body).toBe('Owen Owner: you are owed $5.00')
  })
})

describe('repeating expense notices', () => {
  const upcoming = (data: Record<string, unknown>) =>
    describeNotification(
      row('recurring.upcoming', {
        recurring_id: 'r-1',
        group_id: 'g-1',
        description: 'Rent',
        amount_cents: 150000,
        currency: 'USD',
        posts_on: '2030-01-10',
        deadline: '2030-01-10T00:10:00+00:00',
        ...data,
      }),
      ctx,
    )
  // The deadline is 00:10 UTC on the posting date, which is the evening before in New York.
  const deadline = `${formatDate('2030-01-10T00:10:00Z', { timeZone: 'America/New_York', style: 'weekday' })}, ${formatTime('2030-01-10T00:10:00Z', { timeZone: 'America/New_York' })}`

  it('names the posting date, each person their share, and the deadline in their zone', () => {
    const view = upcoming({ share_cents: 50000, paid_cents: 150000 })
    expect(view.title).toBe(
      `Rent goes in on ${formatDate('2030-01-10', { timeZone: 'UTC', style: 'weekday' })}`,
    )
    expect(view.body).toBe(
      `Your share will be $500.00 of $1,500.00 in Hike crew. Skip or change it before ${deadline}.`,
    )
    expect(deadline).toMatch(/Jan 9/)
    expect(view.kind).toBe('money')
    expect(view.target).toEqual({ to: '/recurring/$recurringId', params: { recurringId: 'r-1' } })
  })

  it('tells a payer outside the split what they cover', () => {
    expect(upcoming({ share_cents: 0, paid_cents: 150000 }).body).toBe(
      `You cover the $1,500.00 in Hike crew. Skip or change it before ${deadline}.`,
    )
  })

  it('falls back to the amount and the group when the details are missing', () => {
    const view = upcoming({ recurring_id: undefined, deadline: undefined })
    expect(view.body).toBe('$1,500.00 in Hike crew.')
    expect(view.target).toEqual({ to: '/groups/$groupId', params: { groupId: 'g-1' } })
  })

  it('says a repeating expense paused because someone left, and who', () => {
    const view = describeNotification(
      row('recurring.paused', {
        recurring_id: 'r-1',
        group_id: 'g-1',
        description: 'Internet',
        user_ids: ['u-ben'],
      }),
      ctx,
    )
    expect(view.title).toBe('"Internet" is paused')
    expect(view.body).toBe('Ben left Hike crew. Take them out of the split to start it again.')
    expect(view.target).toEqual({ to: '/recurring/$recurringId', params: { recurringId: 'r-1' } })
    expect(describeNotification(row('recurring.paused', { group_id: 'g-1' }), ctx).body).toBe(
      'Someone left Hike crew. Take them out of the split to start it again.',
    )
  })
})
