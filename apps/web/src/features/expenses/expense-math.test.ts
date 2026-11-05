import { describe, expect, it } from 'vitest'
import { decimal, expensesToCsv, viewerLine } from './expense-math'
import { BEN, CLEO, ME, expense, members } from './test-utils'

describe('viewerLine', () => {
  it('is what you lent when you paid, and your share when someone else did', () => {
    expect(viewerLine(expense({ paid_by: ME }), ME)).toEqual({ kind: 'lent', cents: 2000 })
    expect(viewerLine(expense({ paid_by: BEN }), ME)).toEqual({ kind: 'borrowed', cents: 1000 })
    expect(
      viewerLine(
        expense({
          paid_by: BEN,
          expense_splits: [{ user_id: CLEO, share_cents: 3000, weight: null }],
        }),
        ME,
      ),
    ).toEqual({ kind: 'none' })
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
          fx_rate: 1.1,
          amount_cents: 1000,
          spent_at: '2026-10-07',
          paid_by: BEN,
          notes: '=SUM(A1)',
          expense_splits: [
            { user_id: ME, share_cents: 500, weight: null },
            { user_id: BEN, share_cents: 500, weight: null },
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

  it('formats amounts by the currency minor unit', () => {
    expect(decimal(1500, 'JPY')).toBe('1500')
    expect(decimal(1234, 'USD')).toBe('12.34')
    expect(decimal(-5, 'USD')).toBe('-0.05')
    expect(decimal(1234, 'KWD')).toBe('1.234')
  })
})
