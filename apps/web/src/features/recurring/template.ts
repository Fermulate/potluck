import type {
  ExpenseItem,
  ExpensePayer,
  ExpenseSplit,
  ExpenseWithSplits,
  MoneyMember,
  RecurringExpense,
} from '@potluck/api'
import { can, firstOccurrenceFrom, nextOccurrence, type Recurrence } from '@potluck/core'

/** The parts of an expense the form edits, which a repeating expense has too. */
export type TemplateAsExpense = Pick<
  ExpenseWithSplits,
  | 'amount_cents'
  | 'currency'
  | 'description'
  | 'category'
  | 'paid_by'
  | 'expense_payers'
  | 'split_type'
  | 'expense_splits'
  | 'expense_items'
  | 'tax_cents'
  | 'tip_cents'
  | 'discount_cents'
>

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : []
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * A repeating expense in the shape of an expense, so the expense form can open it. Its `splits`
 * are stored in the payload format (`{user_id, weight?, share_cents?, adjustment_cents?}`), which
 * is what the form reads back from an expense's split rows; `payers` is null for one payer.
 */
export function templateAsExpense(template: RecurringExpense): TemplateAsExpense {
  const payers: ExpensePayer[] = template.payers
    ? list(template.payers).map((p) => ({
        user_id: str(p.user_id),
        paid_cents: num(p.paid_cents) ?? 0,
      }))
    : [{ user_id: template.paid_by, paid_cents: template.amount_cents }]
  const splits: ExpenseSplit[] = list(template.splits).map((s) => ({
    user_id: str(s.user_id),
    share_cents: num(s.share_cents) ?? 0,
    weight: num(s.weight),
    adjustment_cents: num(s.adjustment_cents),
  }))
  const items: ExpenseItem[] = list(template.items).map((item, position) => ({
    position,
    description: str(item.description),
    amount_cents: num(item.amount_cents) ?? 0,
    user_ids: Array.isArray(item.user_ids) ? item.user_ids.map(str) : [],
  }))
  return {
    amount_cents: template.amount_cents,
    currency: template.currency,
    description: template.description,
    category: template.category,
    paid_by: template.paid_by,
    expense_payers: payers,
    split_type: template.split_type,
    expense_splits: splits,
    expense_items: items,
    tax_cents: template.tax_cents,
    tip_cents: template.tip_cents,
    discount_cents: template.discount_cents,
  }
}

/** Everyone a repeating expense names: payers and the people in the split. */
export function templatePeople(template: RecurringExpense): string[] {
  const shape = templateAsExpense(template)
  return [
    ...new Set([
      ...shape.expense_payers.map((p) => p.user_id),
      ...shape.expense_splits.map((s) => s.user_id),
    ]),
  ]
}

/**
 * Members a repeating expense may name: a closed account that keeps its membership because of a
 * balance counts as gone, as on the server (`private.recurring_departed`).
 */
export function openMemberIds(members: readonly Pick<MoneyMember, 'id' | 'deleted_at'>[]) {
  return members.filter((m) => !m.deleted_at).map((m) => m.id)
}

/** People it names who left the group or closed their account, in the order it names them. */
export function templateDeparted(
  template: RecurringExpense,
  members: readonly Pick<MoneyMember, 'id' | 'deleted_at'>[],
) {
  const open = new Set(openMemberIds(members))
  return templatePeople(template).filter((id) => !open.has(id))
}

/**
 * Who may change, skip, pause or stop it, as the server checks (`private.recurring_involves`):
 * an admin, or anyone it involves (whoever set it up, a payer, someone in the split), the same
 * rule as for expenses.
 */
export function canManageTemplate(
  template: RecurringExpense,
  role: Parameters<typeof can>[0],
  viewerId: string,
  archived: boolean,
): boolean {
  const involved =
    template.created_by === viewerId ||
    template.paid_by === viewerId ||
    templatePeople(template).includes(viewerId)
  return !archived && can(role, 'expense.edit', { isOwn: involved })
}

/** The date after the next one, from the day the series repeats on. */
export function dateAfter(
  template: Pick<RecurringExpense, 'next_run_on' | 'recurrence' | 'anchor_day'>,
) {
  return nextOccurrence(template.next_run_on, template.recurrence, {
    anchorDay: template.anchor_day ?? undefined,
  })
}

/**
 * Where an expense dated `spentAt` would repeat next if it started repeating today: one period
 * after its date, or the next date still to come (as `make_expense_recurring` works it out).
 */
export function firstRepeat(spentAt: string, recurrence: Recurrence, today: string): string {
  return firstOccurrenceFrom(spentAt, recurrence, today)
}
