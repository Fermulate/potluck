import { describe, expect, it } from 'vitest'
import { draftFromExpense } from '@/features/expenses/form/split-state'
import { payersFromExpense } from '@/features/expenses/form/payers-state'
import { BEN, CLEO, ME } from '@/features/expenses/test-utils'
import {
  canManageTemplate,
  dateAfter,
  firstRepeat,
  templateAsExpense,
  templateDeparted,
  templatePeople,
} from './template'
import { template } from './test-utils'

const members = [ME, BEN, CLEO]

describe('templateAsExpense', () => {
  it('reads one payer from paid_by and an equal split from the people listed', () => {
    const shape = templateAsExpense(template())
    expect(shape.expense_payers).toEqual([{ user_id: ME, paid_cents: 150000 }])
    expect(payersFromExpense(shape)).toEqual({ mode: 'single', paidBy: ME })
    const draft = draftFromExpense(shape, members)
    expect(draft.mode).toBe('equal')
    expect(draft.participants).toEqual([ME, BEN, CLEO])
  })

  it('reopens several payers and an adjustment split', () => {
    const shape = templateAsExpense(
      template({
        amount_cents: 160000,
        payers: [
          { user_id: ME, paid_cents: 100000 },
          { user_id: BEN, paid_cents: 60000 },
        ],
        split_type: 'adjustment',
        splits: [{ user_id: ME, adjustment_cents: 10000 }, { user_id: BEN }, { user_id: CLEO }],
      }),
    )
    expect(payersFromExpense(shape)).toEqual({
      mode: 'several',
      amounts: { [ME]: 100000, [BEN]: 60000 },
    })
    const draft = draftFromExpense(shape, members)
    expect(draft.mode).toBe('adjustment')
    expect(draft.adjust).toEqual({ [ME]: 10000, [BEN]: null, [CLEO]: null })
  })

  it('reopens percentages, shares and exact amounts', () => {
    const percent = draftFromExpense(
      templateAsExpense(
        template({
          split_type: 'percent',
          splits: [
            { user_id: ME, weight: 60 },
            { user_id: BEN, weight: 40 },
          ],
        }),
      ),
      members,
    )
    expect(percent.percent).toEqual({ [ME]: 6000, [BEN]: 4000 })
    const exact = draftFromExpense(
      templateAsExpense(
        template({
          split_type: 'exact',
          splits: [
            { user_id: ME, share_cents: 100000 },
            { user_id: CLEO, share_cents: 50000 },
          ],
        }),
      ),
      members,
    )
    expect(exact.exact).toEqual({ [ME]: 100000, [CLEO]: 50000 })
  })

  it('reopens a by-item bill with its items, tax and tip', () => {
    const draft = draftFromExpense(
      templateAsExpense(
        template({
          amount_cents: 9000,
          split_type: 'itemized',
          splits: [
            { user_id: ME, share_cents: 5625 },
            { user_id: BEN, share_cents: 3375 },
          ],
          items: [
            { description: 'Pasta', amount_cents: 5000, user_ids: [ME] },
            { description: 'Salad', amount_cents: 3000, user_ids: [BEN] },
          ],
          tip_cents: 1000,
        }),
      ),
      members,
    )
    expect(draft.mode).toBe('itemized')
    expect(draft.items.map((i) => [i.name, i.amountCents, i.userIds])).toEqual([
      ['Pasta', 5000, [ME]],
      ['Salad', 3000, [BEN]],
    ])
    expect(draft.tipCents).toBe(1000)
  })

  it('tolerates a malformed stored split', () => {
    const shape = templateAsExpense(template({ splits: 'nope', items: [7] }))
    expect(shape.expense_splits).toEqual([])
    expect(shape.expense_items).toEqual([
      { position: 0, description: '', amount_cents: 0, user_ids: [] },
    ])
  })
})

describe('templatePeople', () => {
  it('lists payers and everyone in the split once', () => {
    expect(
      templatePeople(
        template({
          paid_by: BEN,
          payers: [
            { user_id: BEN, paid_cents: 1 },
            { user_id: CLEO, paid_cents: 1 },
          ],
          splits: [{ user_id: ME }, { user_id: BEN }],
        }),
      ),
    ).toEqual([BEN, CLEO, ME])
  })
})

describe('canManageTemplate', () => {
  it('lets an admin or anyone it involves change it, and nobody in an archived group', () => {
    const notMine = template({
      created_by: BEN,
      paid_by: BEN,
      splits: [{ user_id: BEN }, { user_id: CLEO }],
    })
    expect(canManageTemplate(template({ created_by: ME }), 'member', ME, false)).toBe(true)
    // In the split, or paying, is enough, as for expenses.
    expect(
      canManageTemplate(template({ created_by: BEN, paid_by: BEN }), 'member', ME, false),
    ).toBe(true)
    expect(
      canManageTemplate(
        template({
          ...notMine,
          payers: [
            { user_id: ME, paid_cents: 1 },
            { user_id: BEN, paid_cents: 1 },
          ],
        }),
        'member',
        ME,
        false,
      ),
    ).toBe(true)
    expect(canManageTemplate(notMine, 'member', ME, false)).toBe(false)
    expect(canManageTemplate(notMine, 'admin', ME, false)).toBe(true)
    expect(canManageTemplate(template(), 'owner', ME, true)).toBe(false)
  })
})

describe('templateDeparted', () => {
  it('lists the people it names who are not in the group any more', () => {
    expect(templateDeparted(template(), [ME, BEN])).toEqual([CLEO])
    expect(templateDeparted(template(), [ME, BEN, CLEO])).toEqual([])
  })
})
describe('schedule previews', () => {
  it('works out the date after the next one from the anchor day', () => {
    expect(dateAfter(template({ next_run_on: '2027-02-28', anchor_day: 31 }))).toBe('2027-03-31')
    expect(dateAfter(template({ next_run_on: '2027-02-28', anchor_day: null }))).toBe('2027-03-28')
    expect(dateAfter(template({ next_run_on: '2027-01-01', recurrence: 'biweekly' }))).toBe(
      '2027-01-15',
    )
  })

  it('starts a series from an old expense at the next date still to come', () => {
    expect(firstRepeat('2026-11-10', 'monthly', '2026-11-13')).toBe('2026-12-10')
    expect(firstRepeat('2026-08-01', 'monthly', '2026-11-13')).toBe('2026-12-01')
  })
})
