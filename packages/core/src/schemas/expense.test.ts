import { describe, expect, it } from 'vitest'
import { expenseCreateSchema, expenseUpdateSchema, type ExpenseCreateInput } from '../index'

const ALICE = '6f1c1d1e-9a0b-4c55-8d7e-1a2b3c4d5e6f'
const BOB = '0b2e7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const GROUP = 'a8f5f167-f44f-4964-b6c2-3b9f1e2d7c4a'

const valid: ExpenseCreateInput = {
  group_id: GROUP,
  description: '  Tacos  ',
  amount_cents: 3000,
  currency: 'USD',
  paid_by: ALICE,
  split_type: 'equal',
  splits: [
    { user_id: ALICE, share_cents: 1500 },
    { user_id: BOB, share_cents: 1500 },
  ],
  spent_at: '2026-06-12',
}

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? []

describe('expenseCreateSchema', () => {
  it('accepts a valid payload, trimming text and filling optional fields', () => {
    const parsed = expenseCreateSchema.parse(valid)
    expect(parsed.description).toBe('Tacos')
    expect(parsed).toMatchObject({
      category: null,
      notes: null,
      event_id: null,
      receipt_path: null,
    })
  })

  it('accepts every optional field', () => {
    const parsed = expenseCreateSchema.parse({
      ...valid,
      split_type: 'percent',
      splits: [
        { user_id: ALICE, share_cents: 1500, weight: 50 },
        { user_id: BOB, share_cents: 1500, weight: 50 },
      ],
      category: 'food',
      notes: 'extra guac',
      event_id: '3e8f1a2b-4c5d-4e6f-9a0b-1c2d3e4f5a6b',
      receipt_path: `${GROUP}/receipt.jpg`,
    })
    expect(parsed.category).toBe('food')
  })

  it('requires the splits to add up to the amount', () => {
    const result = expenseCreateSchema.safeParse({
      ...valid,
      splits: [
        { user_id: ALICE, share_cents: 1500 },
        { user_id: BOB, share_cents: 1000 },
      ],
    })
    expect(messages(result)).toEqual(['splits_sum_mismatch'])
    expect(result.error?.issues[0]?.path).toEqual(['splits'])
  })

  it('rejects the same person twice', () => {
    const result = expenseCreateSchema.safeParse({
      ...valid,
      splits: [
        { user_id: ALICE, share_cents: 1500 },
        { user_id: ALICE, share_cents: 1500 },
      ],
    })
    expect(messages(result)).toEqual(['duplicate_split_user'])
  })

  it('requires percents that add up to 100 for percent splits', () => {
    const result = expenseCreateSchema.safeParse({
      ...valid,
      split_type: 'percent',
      splits: [
        { user_id: ALICE, share_cents: 1500, weight: 50 },
        { user_id: BOB, share_cents: 1500, weight: 40 },
      ],
    })
    expect(messages(result)).toEqual(['percent_sum'])
  })

  it('requires positive share counts for share splits', () => {
    const result = expenseCreateSchema.safeParse({
      ...valid,
      split_type: 'shares',
      splits: [
        { user_id: ALICE, share_cents: 1500 },
        { user_id: BOB, share_cents: 1500, weight: 0 },
      ],
    })
    expect(messages(result)).toEqual(['shares_required'])
  })

  it.each([
    ['empty description', { description: '   ' }],
    ['zero amount', { amount_cents: 0 }],
    ['fractional amount', { amount_cents: 10.5 }],
    ['lowercase currency', { currency: 'usd' }],
    ['bad payer id', { paid_by: 'alice' }],
    ['unknown split type', { split_type: 'vibes' }],
    ['no splits', { splits: [] }],
    ['unknown category', { category: 'crypto' }],
    ['bad date', { spent_at: '2026-02-30' }],
  ])('rejects %s', (_label, patch) => {
    expect(expenseCreateSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})

describe('expenseCreateSchema, payers and items', () => {
  it('accepts several payers that add up to the amount, and a refund', () => {
    const parsed = expenseCreateSchema.parse({
      ...valid,
      is_refund: true,
      payers: [
        { user_id: ALICE, paid_cents: 2000 },
        { user_id: BOB, paid_cents: 1000 },
      ],
    })
    expect(parsed.is_refund).toBe(true)
    expect(expenseCreateSchema.parse(valid).is_refund).toBe(false)
  })

  it('refuses payers that do not add up, or the same payer twice', () => {
    expect(
      messages(
        expenseCreateSchema.safeParse({
          ...valid,
          payers: [
            { user_id: ALICE, paid_cents: 1500 },
            { user_id: ALICE, paid_cents: 1000 },
          ],
        }),
      ),
    ).toEqual(['duplicate_payer', 'payers_sum_mismatch'])
  })

  it('takes stored items only on a by-item expense', () => {
    const items = [{ description: 'Tacos', amount_cents: 3000, user_ids: [ALICE, BOB] }]
    expect(
      expenseCreateSchema.safeParse({ ...valid, split_type: 'itemized', items, tax_cents: 0 })
        .success,
    ).toBe(true)
    expect(messages(expenseCreateSchema.safeParse({ ...valid, items }))).toEqual([
      'items_need_itemized',
    ])
  })

  it('knows the adjustment split', () => {
    expect(
      expenseCreateSchema.safeParse({
        ...valid,
        split_type: 'adjustment',
        splits: [
          { user_id: ALICE, share_cents: 2000, adjustment_cents: 500 },
          { user_id: BOB, share_cents: 1000, adjustment_cents: -500 },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('expenseUpdateSchema', () => {
  it('takes the same payload without the group id', () => {
    const { group_id: _group, ...update } = valid
    expect(expenseUpdateSchema.parse(update)).not.toHaveProperty('group_id')
  })

  it('applies the same split checks', () => {
    const { group_id: _group, ...update } = valid
    const result = expenseUpdateSchema.safeParse({ ...update, amount_cents: 2999 })
    expect(messages(result)).toEqual(['splits_sum_mismatch'])
  })
})
