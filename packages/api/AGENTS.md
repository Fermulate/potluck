# packages/api

Typed Supabase queries, mutations and TanStack Query options, shared by web and the future native app.
Root rules: [../../AGENTS.md](../../AGENTS.md).

- No DOM, no `react-dom`, no browser globals. React is a peer dependency (query hooks only).
- One file per domain: `groups.ts`, `money.ts`, `payments.ts` (record, edit, restore, bulk settle,
  reminders, payment methods), `plans.ts`, `me.ts`, `notification-prefs.ts`,
  `insights.ts` (search, totals, deleted items), re-exported from `src/index.ts`.
  Each has a `*Keys` object for query keys (invalidate by prefix); `moneyQueries` and `planQueries`
  hold the shared `queryOptions`.
- `src/database.types.ts` is generated (`pnpm db:types`, needs the local DB reset to your migrations).
  A new RPC or column is untyped until you regenerate; never hand-edit or cast around it.
- Select strings must be single string literals: supabase-js derives the row type from them, and a
  concatenated string turns the result into an error type.
- Read `fx_rate` and `fx_rates.rate` as `::text`. `Expense` and `Settlement` are the read types with
  `fx_rate: string`; RPC results are `ExpenseRow` / `SettlementRow` (number).
- Expense writes call `create_expense_v2` / `update_expense_v2` (payers, refunds, stored items); the v1
  RPCs stay for old clients. `EXPENSE_SELECT` reads `expense_payers` and `expense_items` with the splits.
- Paged reads use `fetchAllPages` (`src/paging.ts`); PostgREST caps responses at 1000 rows.
- Throw the PostgREST error as is (`unwrap`); screens translate `error.message` codes.
- Tests: `src/testing/fake-supabase.ts` is an in-memory recorder (`fakeSupabase({ tables })`,
  `.respond('rpc:name', ...)`, `queries(table)`, `argsOf(call, method)`). Coverage threshold: 90%
  functions and branches (`vitest.config.ts`).
- Run one file: `pnpm --filter @potluck/api exec vitest run src/money.test.ts`.
