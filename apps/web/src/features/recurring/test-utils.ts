import type { RecurringExpense } from '@potluck/api'
import { BEN, CLEO, GROUP_ID, ME } from '@/features/expenses/test-utils'

/** A repeating expense as `recurring_expenses` returns it: rent, monthly, split three ways. */
export function template(patch: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'r1',
    group_id: GROUP_ID,
    description: 'Rent',
    amount_cents: 150000,
    currency: 'USD',
    paid_by: ME,
    payers: null,
    split_type: 'equal',
    category: 'rent',
    splits: [{ user_id: ME }, { user_id: BEN }, { user_id: CLEO }],
    items: null,
    tax_cents: null,
    tip_cents: null,
    discount_cents: null,
    recurrence: 'monthly',
    next_run_on: '2099-12-01',
    anchor_day: 1,
    active: true,
    notes: null,
    created_by: ME,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...patch,
  }
}
