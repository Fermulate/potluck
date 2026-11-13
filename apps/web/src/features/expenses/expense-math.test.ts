import { describe, expect, it } from 'vitest'
import { computeBalances } from '@potluck/core'
import { t } from '@potluck/i18n'
import {
  decimal,
  departedMembers,
  expensesToCsv,
  paidSummary,
  toBalanceExpense,
  viewerLine,
} from './expense-math'
import { BEN, CLEO, ME, expense, members } from './test-utils'

describe('viewerLine', () => {
  it('is what you lent when you paid, and your share when someone else did', () => {
    expect(viewerLine(expense({ paid_by: ME }), ME)).toEqual({ kind: 'lent', cents: 2000 })
    expect(viewerLine(expense({ paid_by: BEN }), ME)).toEqual({ kind: 'borrowed', cents: 1000 })
    expect(
      viewerLine(
        expense({
          paid_by: BEN,
          expense_splits: [
            { user_id: CLEO, share_cents: 3000, weight: null, adjustment_cents: null },
          ],
        }),
        ME,
      ),
    ).toEqual({ kind: 'none' })
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

describe('expensesToCsv', () => {
  it('writes one row per expense with a share column per member, oldest first', () => {
    const csv = expensesToCsv(
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
      members,
      'USD',
    )
    expect(csv.split('\r\n')).toEqual([
      'Date,Description,Category,Paid by,Amount,Currency,Rate,Amount in USD,Ava Chen share,Ben Okafor share,Cleo Park share,Notes',
      `2026-10-07,"Pasteis, ""the good ones""",Food,Ben Okafor,10.00,EUR,1.1,11.00,5.00,5.00,,'=SUM(A1)`,
      '2026-11-04,Tacos,Food,Ava Chen,30.00,USD,1,30.00,10.00,10.00,10.00,',
      '',
    ])
  })

  it('neutralizes anything a spreadsheet would run as a formula, but not plain numbers', () => {
    const notesCell = (notes: string) => {
      const csv = expensesToCsv([expense({ notes })], members, 'USD')
      return csv.slice(csv.indexOf('\r\n') + 2).replace(/^(?:[^,]*,){11}/, '')
    }
    // Leading minus followed by a digit used to slip through as "a negative number".
    expect(notesCell('-1+1|cmd')).toBe(`'-1+1|cmd\r\n`)
    expect(notesCell(`-2+3+cmd|' /C calc'!A0`)).toBe(`'-2+3+cmd|' /C calc'!A0\r\n`)
    expect(notesCell('=1+1')).toBe(`'=1+1\r\n`)
    expect(notesCell('+1+1')).toBe(`'+1+1\r\n`)
    expect(notesCell('@SUM(A1)')).toBe(`'@SUM(A1)\r\n`)
    expect(notesCell('\t=1+1')).toBe(`'\t=1+1\r\n`)
    expect(notesCell('\r=1+1')).toBe(`"'\r=1+1"\r\n`)
    // Real numbers stay numbers.
    expect(notesCell('-5')).toBe('-5\r\n')
    expect(notesCell('-12.50')).toBe('-12.50\r\n')
    expect(notesCell('42')).toBe('42\r\n')
    expect(notesCell('Split 3 ways')).toBe('Split 3 ways\r\n')
  })

  it('formats amounts by the currency minor unit', () => {
    expect(decimal(1500, 'JPY')).toBe('1500')
    expect(decimal(1234, 'USD')).toBe('12.34')
    expect(decimal(-5, 'USD')).toBe('-0.05')
    expect(decimal(1234, 'KWD')).toBe('1.234')
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
    expect(viewerLine(dinner, ME)).toEqual({ kind: 'lent', cents: 3000 })
    expect(viewerLine(dinner, BEN)).toEqual({ kind: 'none' })
    expect(viewerLine(dinner, CLEO)).toEqual({ kind: 'borrowed', cents: 3000 })
    expect(viewerLine(refund, ME)).toEqual({ kind: 'borrowed', cents: 2000 })
    expect(viewerLine(refund, BEN)).toEqual({ kind: 'lent', cents: 2000 })
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
    const rows = expensesToCsv(
      [dinner, { ...refund, spent_at: '2026-11-05' }],
      members,
      'USD',
    ).split('\r\n')
    expect(rows[1]).toBe(
      '2026-11-04,Tacos,Food,Ava Chen 60.00; Ben Okafor 30.00,90.00,USD,1,90.00,30.00,30.00,30.00,',
    )
    expect(rows[2]).toBe('2026-11-05,Tacos,Food,Ava Chen,-40.00,USD,1,-40.00,-20.00,-20.00,,')
  })
})
