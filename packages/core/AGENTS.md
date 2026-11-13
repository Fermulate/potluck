# packages/core

Pure domain logic shared with a future React Native app. Root rules: [../../AGENTS.md](../../AGENTS.md).

- No `window` / `document` / `localStorage` (eslint enforces), no network or Supabase: callers pass data in.
- Everything public is exported from `src/index.ts` through each folder's `index.ts`.
- Splits, balances, debts, payments, FX, slots, guest names, recurrence and roles also exist in SQL.
  Change both sides in the same PR with the same test cases. Which core function pairs with which SQL
  function: [core and SQL twins](../../docs/architecture.md#core-and-sql-twins).
- `payments/paymentAction` and `payableMethods` build pay links (PayPal.me, Venmo, ...) on the client
  only; Potluck never moves money ([ADR 15](../../docs/adr/0015-payment-links-and-cross-group-settle.md)).
- Money: intermediate products in `BigInt`; round half away from zero; largest remainder with ties to
  the smaller user id compared as code points. FX rates are decimal text with 12 places
  (`numeric(24,12)`); accept `number | string` and keep the text path exact.
- Tests: Vitest + `fast-check` property tests for money code; exact integer assertions only.
  Coverage threshold is 90% statements, branches and functions (`vitest.config.ts`).
- Run one file: `pnpm --filter @potluck/core exec vitest run src/balances/compute-balances.test.ts`.
