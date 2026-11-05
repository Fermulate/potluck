import { z } from 'zod'
import { CATEGORY_IDS } from '../categories'
import { currencyCode, dateOnly, id, optionalText, positiveCents } from './common'

export const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares', 'itemized'] as const
export const splitTypeSchema = z.enum(SPLIT_TYPES)
export type SplitType = z.infer<typeof splitTypeSchema>

export const expenseSplitSchema = z.object({
  user_id: id,
  share_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  /** Percent or share count, kept for display. */
  weight: z.number().nonnegative().finite().nullish(),
})

const expenseFields = {
  description: z.string().trim().min(1).max(140),
  amount_cents: positiveCents,
  currency: currencyCode,
  paid_by: id,
  split_type: splitTypeSchema,
  splits: z.array(expenseSplitSchema).min(1).max(100),
  category: z.enum(CATEGORY_IDS).nullish().default(null),
  notes: optionalText(2000),
  spent_at: dateOnly,
  event_id: id.nullish().default(null),
  receipt_path: z.string().min(1).max(512).nullish().default(null),
}

type ExpenseFields = z.infer<z.ZodObject<typeof expenseFields>>

function checkSplits(expense: ExpenseFields, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['splits'] })

  const users = new Set(expense.splits.map((s) => s.user_id))
  if (users.size !== expense.splits.length) issue('duplicate_split_user')

  const total = expense.splits.reduce((sum, s) => sum + s.share_cents, 0)
  if (total !== expense.amount_cents) issue('splits_sum_mismatch')

  const weights = expense.splits.map((s) => s.weight ?? 0)
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (expense.split_type === 'percent' && Math.abs(weightSum - 100) > 1e-6) issue('percent_sum')
  if (expense.split_type === 'shares' && !weights.every((w) => w > 0)) issue('shares_required')
}

/** Payload for the `create_expense(payload jsonb)` RPC. */
export const expenseCreateSchema = z
  .object({ group_id: id, ...expenseFields })
  .superRefine(checkSplits)

/** Payload for `update_expense(id, payload jsonb)`: a full replacement, minus the group. */
export const expenseUpdateSchema = z.object(expenseFields).superRefine(checkSplits)

export type ExpenseCreateInput = z.input<typeof expenseCreateSchema>
export type ExpenseCreatePayload = z.output<typeof expenseCreateSchema>
export type ExpenseUpdateInput = z.input<typeof expenseUpdateSchema>
export type ExpenseUpdatePayload = z.output<typeof expenseUpdateSchema>
export type ExpenseSplitPayload = z.output<typeof expenseSplitSchema>
