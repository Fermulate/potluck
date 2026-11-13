# packages/core

Pure domain logic shared with a future React Native app. Root rules: [../../AGENTS.md](../../AGENTS.md).

- No DOM, no `react-dom`, no `@potluck/ui`, no `window` / `document` / `localStorage` (eslint enforces).
  No network or Supabase either: callers pass data in.
- Everything public is exported from `src/index.ts` through each folder's `index.ts`.
- These rules also exist in SQL. Change both sides in the same PR and give both the same test cases:

  | core                                           | SQL (live body in `supabase/schema/current.sql`)                  |
  | ---------------------------------------------- | ----------------------------------------------------------------- |
  | `money/` splits, `allocate()`                  | `private.compute_splits`                                          |
  | `money/splitAdjustment`                        | `private.compute_split_rows`                                      |
  | `money/splitItemized` (tax, tip, discount)     | `private.itemized_splits`                                         |
  | `money/checkPayers`, `primaryPayer`            | payers checks in `private.save_expense`                           |
  | `balances/expenseEffect`, `computeBalances`    | view `public.group_balances` (payers credited, refunds flipped)   |
  | `balances/pairwiseDebts`                       | client only; sums per person to `group_balances`                  |
  | `balances/simplifyDebts`                       | `public.simplified_debts`                                         |
  | `currency/convert`, `minorUnits`, `invertRate` | `private.convert_minor`, `private.minor_units`, `private.fx_rate` |
  | `availability/` slots, `rankSlots`, heat       | `public.set_availability` grid check, `public.best_slots`         |
  | `recurrence/nextOccurrence`                    | `private.materialize_recurring_expenses`                          |
  | `roles/can()`                                  | role checks inside each RPC                                       |

- Money: integer minor units; intermediate products in `BigInt`; round half away from zero; largest
  remainder with ties to the smaller user id compared as code points. FX rates are decimal text with 12
  places (`numeric(24,12)`); accept `number | string` and keep the text path exact.
- Tests: Vitest + `fast-check` property tests for money code; exact integer assertions only.
  Coverage threshold is 90% statements, branches and functions (`vitest.config.ts`).
- Run one file: `pnpm --filter @potluck/core exec vitest run src/balances/compute-balances.test.ts`.
