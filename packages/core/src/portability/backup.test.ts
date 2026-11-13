import { describe, expect, it } from 'vitest'
import { backupLedger, backupSchema } from './backup'

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
  payment_methods: [],
  people: [
    { id: id(1), display_name: 'Ava', deleted: false, placeholder: false },
    { id: id(3), display_name: 'Sam', deleted: false, placeholder: true },
  ],
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

  it('reads payment comments, payment methods and template fields', () => {
    const full = JSON.parse(JSON.stringify(sample)) as typeof sample
    ;(full as Record<string, unknown>).payment_methods = [
      { kind: 'paypal', handle: 'avachen', updated_at: at },
    ]
    const group = full.groups[0]! as unknown as Record<string, unknown[]>
    group.payments = [
      {
        id: id(40),
        from_user: id(1),
        to_user: id(2),
        amount_cents: 500,
        currency: 'USD',
        fx_rate: '1.000000000000',
        note: null,
        settled_at: at,
        created_by: id(1),
        created_at: at,
        deleted_at: null,
        comments: [{ id: id(31), author_id: id(2), body: 'Thanks!', created_at: at }],
      },
    ]
    group.recurring = [
      {
        id: id(50),
        description: 'Wifi',
        amount_cents: 4000,
        currency: 'USD',
        paid_by: id(1),
        payers: null,
        split_type: 'equal',
        splits: [],
        items: null,
        tax_cents: null,
        tip_cents: null,
        discount_cents: null,
        category: null,
        notes: 'Router in the hall',
        recurrence: 'monthly',
        anchor_day: 31,
        next_run_on: '2026-04-30',
        active: true,
        created_by: id(1),
        created_at: at,
        updated_at: at,
      },
    ]
    const parsed = backupSchema.parse(full)
    expect(parsed.payment_methods[0]!.handle).toBe('avachen')
    expect(parsed.groups[0]!.payments[0]!.comments[0]!.body).toBe('Thanks!')
    expect(parsed.groups[0]!.recurring[0]!.anchor_day).toBe(31)
  })

  it('lists seats as people, marked as seats', () => {
    expect(backupSchema.parse(sample).people.find((p) => p.placeholder)?.display_name).toBe('Sam')
  })

  it('wants every field export_my_data writes', () => {
    const { payment_methods: _, ...rest } = sample
    expect(backupSchema.safeParse(rest).success).toBe(false)
  })

  it('refuses another format, version, or a rate as a number', () => {
    expect(backupSchema.safeParse({ ...sample, version: 2 }).success).toBe(false)
    expect(backupSchema.safeParse({ ...sample, format: 'splitwise' }).success).toBe(false)
    const numeric = JSON.parse(JSON.stringify(sample)) as typeof sample
    ;(numeric.groups[0]!.expenses[0] as { fx_rate: unknown }).fx_rate = 1
    expect(backupSchema.safeParse(numeric).success).toBe(false)
  })
})

describe('backupLedger', () => {
  it('keeps live rows only and names everyone', () => {
    const backup = backupSchema.parse(JSON.parse(JSON.stringify(sample)) as typeof sample)
    const group = backup.groups[0]!
    group.expenses.push({ ...group.expenses[0]!, id: id(21), deleted_at: at })
    group.payments.push({
      id: id(40),
      from_user: id(1),
      to_user: id(2),
      amount_cents: 500,
      currency: 'USD',
      fx_rate: '1',
      note: null,
      settled_at: '2026-03-01T23:30:00-05:00',
      created_by: id(1),
      created_at: at,
      deleted_at: null,
      comments: [],
    })
    group.payments.push({ ...group.payments[0]!, id: id(41), deleted_at: at })
    const { groups, nameOf } = backupLedger(backup, 'America/New_York')
    expect(groups[0]!.expenses).toHaveLength(1)
    expect(groups[0]!.expenses[0]!.payers).toEqual([{ userId: id(1), paidCents: 9000 }])
    expect(groups[0]!.payments).toHaveLength(1)
    expect(groups[0]!.payments[0]!.day).toBe('2026-03-01')
    expect(nameOf(id(1))).toBe('Ava')
    expect(nameOf(id(9))).toBe(id(9))
  })

  it("dates a payment on the viewer's day, as settle_up_v2 stored it", () => {
    const backup = backupSchema.parse(JSON.parse(JSON.stringify(sample)) as typeof sample)
    // Noon on March 2 in Auckland (UTC+13) is 23:00 UTC on March 1.
    backup.groups[0]!.payments.push({
      id: id(42),
      from_user: id(1),
      to_user: id(2),
      amount_cents: 500,
      currency: 'USD',
      fx_rate: '1',
      note: null,
      settled_at: '2026-03-01T23:00:00+00:00',
      created_by: id(1),
      created_at: at,
      deleted_at: null,
      comments: [],
    })
    expect(backupLedger(backup, 'Pacific/Auckland').groups[0]!.payments[0]!.day).toBe('2026-03-02')
    expect(backupLedger(backup, 'UTC').groups[0]!.payments[0]!.day).toBe('2026-03-01')
  })
})
