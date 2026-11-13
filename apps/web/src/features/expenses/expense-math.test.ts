import { describe, expect, it } from 'vitest'
import { computeBalances } from '@potluck/core'
import { t } from '@potluck/i18n'
import {
  departedMembers,
  groupCsv,
  paidSummary,
  toBalanceExpense,
  viewerLine,
} from './expense-math'
import { BEN, CLEO, ME, expense, members } from './test-utils'

describe('viewerLine', () => {
  it('is what you lent when you paid, and your share when someone else did', () => {
    expect(viewerLine(expense({ paid_by: ME }), ME, 'USD')).toEqual({ kind: 'lent', cents: 2000 })
    expect(viewerLine(expense({ paid_by: BEN }), ME, 'USD')).toEqual({
      kind: 'borrowed',
      cents: 1000,
    })
    expect(
      viewerLine(
        expense({
          paid_by: BEN,
          expense_splits: [
            { user_id: CLEO, share_cents: 3000, weight: null, adjustment_cents: null },
          ],
        }),
        ME,
        'USD',
      ),
    ).toEqual({ kind: 'none' })
  })

  it('agrees with the balance on a foreign expense with several payers', () => {
    // 10.00 EUR at 0.5 into USD is 5.00. I paid 3.34 EUR and my share is 3.33 EUR, so in euros
    // I am a cent ahead; but converted first and spread after (as the server does), I paid
    // $1.67 and my share is $1.67 (the tied leftover cent goes to the smaller id, mine).
    const foreign = expense({
      currency: 'EUR',
      fx_rate: '0.500000000000',
      amount_cents: 1000,
      expense_payers: [
        { user_id: ME, paid_cents: 334 },
        { user_id: BEN, paid_cents: 666 },
      ],
      expense_splits: [
        { user_id: ME, share_cents: 333, weight: null, adjustment_cents: null },
        { user_id: BEN, share_cents: 333, weight: null, adjustment_cents: null },
        { user_id: CLEO, share_cents: 334, weight: null, adjustment_cents: null },
      ],
    })
    const balances = computeBalances([toBalanceExpense(foreign)], [], { groupCurrency: 'USD' })
    expect(balances[ME]).toBe(0)
    expect(viewerLine(foreign, ME, 'USD')).toEqual({ kind: 'none' })
    expect(viewerLine(foreign, CLEO, 'USD')).toEqual({ kind: 'borrowed', cents: -balances[CLEO]! })
    expect(viewerLine(foreign, BEN, 'USD')).toEqual({ kind: 'lent', cents: balances[BEN]! })
  })
})

describe('departedMembers', () => {
  const GONE = 'dddddddd-0000-4000-8000-000000000004'
  const ids = [ME, BEN, CLEO]

  it('finds a payer or a share holder who is no longer in the group', () => {
    expect(departedMembers(expense({}), ids)).toEqual([])
    expect(departedMembers(expense({ paid_by: GONE }), ids)).toEqual([GONE])
    const split = [
      { user_id: ME, share_cents: 1000, weight: null, adjustment_cents: null },
      { user_id: GONE, share_cents: 2000, weight: null, adjustment_cents: null },
    ]
    expect(departedMembers(expense({ expense_splits: split }), ids)).toEqual([GONE])
    expect(departedMembers(expense({ paid_by: GONE, expense_splits: split }), ids)).toEqual([GONE])
  })

  it('ignores someone who left with a zero share', () => {
    const split = [
      { user_id: ME, share_cents: 3000, weight: 1, adjustment_cents: null },
      { user_id: GONE, share_cents: 0, weight: 0, adjustment_cents: null },
    ]
    expect(departedMembers(expense({ expense_splits: split }), ids)).toEqual([])
  })
})

describe('groupCsv', () => {
  const people = new Map(members.map((m) => [m.id, m]))
  const trip = { name: 'Trip', currency: 'USD', members }

  it('writes one row per expense, oldest first, with paid, share and balance per member', () => {
    const csv = groupCsv(
      trip,
      [
        expense({ description: 'Tacos', spent_at: '2026-11-04' }),
        expense({
          id: 'e2',
          description: 'Pasteis, "the good ones"',
          currency: 'EUR',
          fx_rate: '1.100000000000',
          amount_cents: 1000,
          spent_at: '2026-10-07',
          paid_by: BEN,
          notes: '=SUM(A1)',
          expense_splits: [
            { user_id: ME, share_cents: 500, weight: null, adjustment_cents: null },
            { user_id: BEN, share_cents: 500, weight: null, adjustment_cents: null },
          ],
        }),
      ],
      [],
      people,
    )
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe(
      'Date,Group,Type,Description,Category,Amount,Currency,Rate,Group currency,Amount in group currency,Paid by,' +
        'Ava Chen paid,Ava Chen share,Ava Chen balance,Ben Okafor paid,Ben Okafor share,Ben Okafor balance,' +
        'Cleo Park paid,Cleo Park share,Cleo Park balance,Notes,Items',
    )
    expect(rows[1]).toBe(
      `2026-10-07,Trip,Expense,"Pasteis, ""the good ones""",Food,10.00,EUR,1.1,USD,11.00,Ben Okafor,,5.00,-5.50,10.00,5.00,5.50,,,,'=SUM(A1),`,
    )
    expect(rows[2]).toBe(
      '2026-11-04,Trip,Expense,Tacos,Food,30.00,USD,1,USD,30.00,Ava Chen,30.00,10.00,20.00,,10.00,-10.00,,10.00,-10.00,,',
    )
    expect(rows[3]).toBe(',Trip,Balance,,,,,,USD,,,,,14.50,,,-4.50,,,-10.00,,')
  })

  it('lists payments and anyone who has left', () => {
    const GONE = 'dddddddd-0000-4000-8000-000000000004'
    const csv = groupCsv(
      trip,
      [],
      [
        {
          id: 's1',
          group_id: 'g',
          from_user: GONE,
          to_user: ME,
          amount_cents: 500,
          currency: 'USD',
          fx_rate: '1.000000000000',
          note: null,
          settled_at: '2026-11-05T12:00:00Z',
          created_by: GONE,
          created_at: '2026-11-05T12:00:00Z',
          deleted_at: null,
        },
      ],
      new Map<string, { display_name: string }>([...people, [GONE, { display_name: 'Dee Gone' }]]),
    )
    const rows = csv.split('\r\n')
    expect(rows[0]).toContain('Dee Gone paid')
    expect(rows[1]).toMatch(
      /^2026-11-05,Trip,Payment,Dee Gone paid Ava Chen,,5.00,USD,1,USD,5.00,Dee Gone,/,
    )
  })
})

describe('several payers and refunds', () => {
  // 90 paid 60 by Ava (me) and 30 by Ben, split equally between three.
  const dinner = expense({
    amount_cents: 9000,
    paid_by: ME,
    expense_payers: [
      { user_id: BEN, paid_cents: 3000 },
      { user_id: ME, paid_cents: 6000 },
    ],
    expense_splits: [
      { user_id: ME, share_cents: 3000, weight: null, adjustment_cents: null },
      { user_id: BEN, share_cents: 3000, weight: null, adjustment_cents: null },
      { user_id: CLEO, share_cents: 3000, weight: null, adjustment_cents: null },
    ],
  })
  // A 40 refund received by Ava (me), split between Ava and Ben.
  const refund = expense({
    amount_cents: 4000,
    is_refund: true,
    expense_splits: [
      { user_id: ME, share_cents: 2000, weight: null, adjustment_cents: null },
      { user_id: BEN, share_cents: 2000, weight: null, adjustment_cents: null },
    ],
  })
  const nameOf = (id: string) => (id === ME ? 'You' : id === BEN ? 'Ben' : 'Cleo')

  it('nets what each person paid against their share', () => {
    expect(viewerLine(dinner, ME, 'USD')).toEqual({ kind: 'lent', cents: 3000 })
    expect(viewerLine(dinner, BEN, 'USD')).toEqual({ kind: 'none' })
    expect(viewerLine(dinner, CLEO, 'USD')).toEqual({ kind: 'borrowed', cents: 3000 })
    expect(viewerLine(refund, ME, 'USD')).toEqual({ kind: 'borrowed', cents: 2000 })
    expect(viewerLine(refund, BEN, 'USD')).toEqual({ kind: 'lent', cents: 2000 })
  })

  it('agrees with core balances to the cent', () => {
    expect(computeBalances([toBalanceExpense(dinner), toBalanceExpense(refund)])).toEqual({
      [ME]: 3000 - 2000,
      [BEN]: 0 + 2000,
      [CLEO]: -3000,
    })
  })

  it('says who paid', () => {
    expect(paidSummary(dinner, ME, nameOf)).toBe('You and Ben paid $90.00')
    expect(paidSummary(refund, ME, nameOf)).toBe(
      t('expenses.refund.youGotBack', { amount: '$40.00' }),
    )
    expect(paidSummary(expense({ paid_by: BEN, is_refund: true }), ME, nameOf)).toBe(
      t('expenses.refund.gotBack', { name: 'Ben', amount: '$30.00' }),
    )
    expect(paidSummary({ ...dinner, is_refund: true }, ME, nameOf)).toBe(
      t('expenses.refund.gotBackMany', { names: 'You and Ben', amount: '$90.00' }),
    )
  })

  it('counts a payer who left as departed', () => {
    const GONE = 'dddddddd-0000-4000-8000-000000000004'
    expect(
      departedMembers(
        { ...dinner, expense_payers: [...dinner.expense_payers, { user_id: GONE, paid_cents: 1 }] },
        [ME, BEN, CLEO],
      ),
    ).toEqual([GONE])
  })

  it('lists every payer in the CSV and makes refunds negative', () => {
    const rows = groupCsv(
      { name: 'Trip', currency: 'USD', members },
      [dinner, { ...refund, spent_at: '2026-11-05' }],
      [],
      new Map(members.map((m) => [m.id, m])),
    ).split('\r\n')
    expect(rows[1]).toContain(
      '"Ava Chen 60.00; Ben Okafor 30.00",60.00,30.00,30.00,30.00,30.00,0.00',
    )
    expect(rows[2]).toContain(
      'Refund,Tacos,Food,-40.00,USD,1,USD,-40.00,Ava Chen,-40.00,-20.00,-20.00,,-20.00,20.00',
    )
  })
})
