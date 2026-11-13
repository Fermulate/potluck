import { describe, expect, it } from 'vitest'
import { backupSchema } from './backup'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = '2026-03-01T12:00:00+00:00'

const sample = {
  format: 'potluck-backup',
  version: 1,
  exported_at: at,
  profile: {
    id: id(1),
    display_name: 'Ava',
    email: 'ava@example.com',
    avatar_path: null,
    timezone: 'Europe/Paris',
    default_currency: 'EUR',
    locale: 'en',
    created_at: at,
  },
  people: [{ id: id(1), display_name: 'Ava', deleted: false }],
  friends: [id(2)],
  groups: [
    {
      id: id(10),
      name: 'Trip',
      emoji: null,
      color: 'saffron',
      currency: 'USD',
      is_direct: false,
      simplify_debts: true,
      members_can_invite: true,
      default_split: null,
      created_by: id(1),
      created_at: at,
      archived_at: null,
      members: [{ user_id: id(1), role: 'owner', joined_at: at }],
      expenses: [
        {
          id: id(20),
          description: 'Dinner',
          amount_cents: 9000,
          currency: 'USD',
          fx_rate: '1.000000000000',
          is_refund: false,
          split_type: 'equal',
          category: 'food',
          notes: null,
          spent_at: '2026-03-01',
          tax_cents: null,
          tip_cents: null,
          discount_cents: null,
          event_id: null,
          recurring_id: null,
          receipt_path: null,
          created_by: id(1),
          created_at: at,
          updated_at: at,
          deleted_at: null,
          payers: [{ user_id: id(1), paid_cents: 9000 }],
          splits: [{ user_id: id(1), share_cents: 9000, weight: null, adjustment_cents: null }],
          items: [],
          comments: [{ id: id(30), author_id: id(1), body: 'Yum', created_at: at }],
        },
      ],
      payments: [],
      recurring: [],
      plans: [],
    },
  ],
}

describe('backupSchema', () => {
  it('accepts a version 1 backup', () => {
    expect(backupSchema.parse(sample).groups[0]!.expenses[0]!.fx_rate).toBe('1.000000000000')
  })

  it('refuses another format, version, or a rate as a number', () => {
    expect(backupSchema.safeParse({ ...sample, version: 2 }).success).toBe(false)
    expect(backupSchema.safeParse({ ...sample, format: 'splitwise' }).success).toBe(false)
    const numeric = structuredClone(sample)
    ;(numeric.groups[0]!.expenses[0] as { fx_rate: unknown }).fx_rate = 1
    expect(backupSchema.safeParse(numeric).success).toBe(false)
  })
})
