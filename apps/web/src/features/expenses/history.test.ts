import { describe, expect, it } from 'vitest'
import { describeChanges } from './history'
import { BEN, CLEO, ME } from './test-utils'

const names: Record<string, string> = { [ME]: 'You', [BEN]: 'Ben', [CLEO]: 'Cleo' }
const nameOf = (id: string, o?: { lower?: boolean }) =>
  id === ME && o?.lower ? 'you' : (names[id] ?? 'Someone')
const describe_ = (data: Record<string, unknown>) => describeChanges(data, { viewerId: ME, nameOf })

describe('describeChanges', () => {
  it('lists every changed field with its old and new value', () => {
    expect(
      describe_({
        currency: 'USD',
        changes: {
          notes: { from: null, to: 'window seat' },
          description: { from: 'Dinner', to: 'Dinner out' },
          amount_cents: { from: 9000, to: 9600 },
          spent_at: { from: '2026-11-01', to: '2026-11-02' },
          category: { from: null, to: 'food' },
          payers: {
            from: { [BEN]: 9000 },
            to: { [BEN]: 3600, [ME]: 6000 },
          },
          split: {
            from: { type: 'equal', shares: { [ME]: 4500, [BEN]: 4500 } },
            to: { type: 'exact', shares: { [ME]: 5600, [CLEO]: 4000 } },
          },
        },
      }),
    ).toEqual([
      'Name: "Dinner" to "Dinner out"',
      'Amount: $90.00 to $96.00',
      'Paid by: Ben to you $60.00 and Ben $36.00',
      'Split: equally, you $45.00 and Ben $45.00 to exact amounts, you $56.00 and Cleo $40.00',
      'Date: Nov 1, 2026 to Nov 2, 2026',
      'Category: Other to Food',
      'Notes added: "window seat"',
    ])
  })

  it('reads old amounts in the old currency and names refund and receipt changes', () => {
    expect(
      describe_({
        currency: 'EUR',
        is_refund: true,
        changes: {
          currency: { from: 'USD', to: 'EUR' },
          amount_cents: { from: 1000, to: 2000 },
          paid_by: { from: BEN, to: ME },
          is_refund: { from: false, to: true },
          receipt: { from: false, to: true },
          event_id: { from: null, to: 'e1' },
          split_type: { from: 'equal', to: 'shares' },
        },
      }),
    ).toEqual([
      'Amount: $10.00 to €20.00',
      'Currency: USD to EUR',
      'Received by: Ben to you',
      'Split: equally to shares',
      'Marked as a refund',
      'Receipt added',
      'Linked to a different plan',
    ])
    expect(
      describe_({
        changes: { is_refund: { from: true, to: false }, receipt: { from: true, to: false } },
      }),
    ).toEqual(['No longer a refund', 'Receipt removed'])
  })

  it('names tax, tip, discount and item changes on a by-item bill', () => {
    expect(
      describe_({
        currency: 'USD',
        changes: {
          tax_cents: { from: 101, to: 51 },
          tip_cents: { from: null, to: 50 },
          discount_cents: { from: 7, to: null },
          items: {
            from: [{ description: '', amount_cents: 1000 }],
            to: [
              { description: 'Bacalhau', amount_cents: 1000 },
              { description: 'Wine', amount_cents: 500 },
            ],
          },
        },
      }),
    ).toEqual([
      'Items: Item 1 $10.00 to Bacalhau $10.00, Wine $5.00',
      'Tax: $1.01 to $0.51',
      'Tip: $0.00 to $0.50',
      'Discount: $0.07 to $0.00',
    ])
  })

  it('says nothing for entries logged before changes were kept', () => {
    expect(describe_({ amount_cents: 100, currency: 'USD' })).toEqual([])
  })
})
