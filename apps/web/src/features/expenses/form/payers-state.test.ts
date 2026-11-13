import { describe, expect, it } from 'vitest'
import {
  checkDraftPayers,
  payerIds,
  payersErrorText,
  payersFromExpense,
  payersLeft,
  payersPayload,
  toSeveral,
} from './payers-state'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'

describe('payers draft', () => {
  it('reads one or several payers from a saved expense', () => {
    expect(
      payersFromExpense({ paid_by: A, expense_payers: [{ user_id: A, paid_cents: 900 }] }),
    ).toEqual({ mode: 'single', paidBy: A })
    expect(payersFromExpense({ paid_by: B, expense_payers: [] })).toEqual({
      mode: 'single',
      paidBy: B,
    })
    expect(
      payersFromExpense({
        paid_by: A,
        expense_payers: [
          { user_id: A, paid_cents: 600 },
          { user_id: B, paid_cents: 300 },
        ],
      }),
    ).toEqual({ mode: 'several', amounts: { [A]: 600, [B]: 300 } })
  })

  it('always sends a payers list, with paid_by as whoever paid the most', () => {
    expect(payersPayload({ mode: 'single', paidBy: B }, 900)).toEqual({
      paid_by: B,
      payers: [{ user_id: B, paid_cents: 900 }],
    })
    expect(payersPayload({ mode: 'several', amounts: { [A]: 300, [B]: 600 } }, 900)).toEqual({
      paid_by: B,
      payers: [
        { user_id: A, paid_cents: 300 },
        { user_id: B, paid_cents: 600 },
      ],
    })
  })

  it('says what is left and why it does not add up', () => {
    const draft = { mode: 'several' as const, amounts: { [A]: 600, [B]: null } }
    expect(payersLeft(draft, 900)).toBe(300)
    expect(payerIds(draft)).toEqual([A])
    expect(payersErrorText(checkDraftPayers(draft, 900))).toBe(
      'What everyone paid needs to add up to the total.',
    )
    expect(payersErrorText(checkDraftPayers({ mode: 'single', paidBy: A }, 900))).toBeNull()
    expect(payersLeft({ mode: 'single', paidBy: A }, 900)).toBe(0)
  })

  it('switches to several payers starting from the one who paid it all', () => {
    expect(toSeveral({ mode: 'single', paidBy: A }, 900)).toEqual({
      mode: 'several',
      amounts: { [A]: 900 },
    })
    expect(toSeveral({ mode: 'single', paidBy: A }, 0)).toEqual({
      mode: 'several',
      amounts: { [A]: null },
    })
  })
})
