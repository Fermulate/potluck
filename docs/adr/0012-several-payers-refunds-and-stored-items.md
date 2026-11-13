# 12. Several payers, refunds and stored line items

- Status: accepted
- Date: 2026-11-13

## Context

Splitwise lets several people pay one bill ("paid 60 by Ava and 30 by Ben"), records refunds that reduce what people owe, splits by adjustment (equal plus a +/- per person), keeps itemized bills so they can be edited, and lets a group save a default split. Potluck had one payer per expense (`expenses.paid_by`), positive amounts only, and threw item details away after saving. `paid_by` is read by balances, the debt view, notifications, permissions, the departed member rules, CSV, rows and the detail page, and by every client already installed.

## Decision

- **Payers are rows.** `expense_payers (expense_id, user_id, paid_cents)` holds every payer in the expense currency, summing to `amount_cents` (deferred constraint trigger). Every expense has at least one row: the migration backfills one from `paid_by`, and a trigger on `expenses` keeps a lone payer in step with `paid_by` and `amount_cents`, so writers that only know `paid_by` (the recurring job, older RPC paths, tests) stay correct without changes.
- **`paid_by` stays** as whoever paid the most (ties to the smaller user id), so older clients still show a sensible payer. Nothing that moves money reads it any more; balances, permissions, notifications and the departed member checks read `expense_payers`.
- **Balances spread the converted total twice.** Each expense is converted once, then spread over the payers by `paid_cents` and over the split by `share_cents`, both largest remainder with ties by user id. Every expense still nets to exactly zero. Core `expenseEffect` and the `group_balances` view implement the same rule with the same test cases. Pairwise debts (simplify off) let each person who comes out behind pay the people ahead in proportion to what those are still owed, so per person they sum to the net balance.
- **A refund is a flag, not a negative amount.** `expenses.is_refund` keeps `amount_cents > 0` (and every check that relies on it) and flips both signs in balances: the payers received the money, the people in the split are credited. A refund cannot repeat.
- **Adjustment is a split type.** `split_type` gains `adjustment`; `expense_splits.adjustment_cents` stores each +/-. The adjustments come off the top and the rest is split equally (core `splitAdjustment`, `private.compute_split_rows`). Adjustments larger than the total, or that take someone below zero, are refused.
- **Itemized bills are stored as entered.** `expense_items` plus `tax_cents`, `tip_cents`, `discount_cents` on the expense. When the payload carries items, the server works out the shares from them (`private.itemized_splits`, same rule as core `splitItemized`, now with a discount) instead of trusting client cents. Any other rewrite of the split drops the items.
- **Versioned RPCs.** `create_expense_v2` / `update_expense_v2` take `payers`, `is_refund`, `items` and the extras. `create_expense` / `update_expense` keep their contract by stripping those keys ([ADR 8](0008-additive-migrations-and-versioned-rpcs.md)); an old client editing a several-payer expense keeps the payers as long as it sends the same `paid_by` and amount, and is refused (`payers_sum_mismatch`) if it changes the amount.
- **The default split is group data.** `groups.default_split` (equal, percent or shares over named members), written only by `set_default_split`, which any member may call. It never moves a balance; new expenses start from it, dropping people who have left.

## Consequences

- Every money reader goes through payers. Code that still reads `paid_by` for money (a future batch, an old client computing pairwise debts) is wrong for several-payer expenses; `payersOf()` in `apps/web/src/features/expenses/expense-math.ts` and `expenseEffect()` in core are the helpers to use.
- One more deferred check runs on every expense write, and the balance view joins one more table (on its primary key).
- Recurring templates carry `payers jsonb`; the recurring editor (parity Batch 8) must write the same shape.
- The CSV lists every payer with what they paid in the "Paid by" cell and shows refunds as negative amounts and shares.
- Old clients see a refund as an ordinary expense in their lists until they update; balances are computed on the server, so they stay right.
