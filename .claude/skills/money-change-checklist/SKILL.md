---
name: money-change-checklist
description: Checklist for any Potluck change that touches amounts, splits, balances, FX conversion, settle up, recurring expenses or debt simplification, on the client or in SQL. Use before writing the code and again before finishing.
---

# Money change checklist

Rules: [ADR 3](../../../docs/adr/0003-integer-minor-units-and-shared-rounding.md) and
"Money conventions" in `docs/architecture.md`.

## Before you write code

- [ ] Find both implementations. Core and SQL pairs are listed in `packages/core/AGENTS.md`
      (`allocate` / `private.compute_splits`, `computeBalances` / `group_balances`,
      `simplifyDebts` / `simplified_debts`, `convert` / `private.convert_minor`, ...).
- [ ] Read the live SQL in `supabase/schema/current.sql`, not an old migration.
- [ ] Write down the cases (amounts, currencies, people, rates) you will test on both sides.

## Invariants

- [ ] Integer minor units only. Digits per currency come from `minorUnits()` / `private.minor_units()`
      (JPY 0, USD 2, KWD 3). No floats; `BigInt` for products.
- [ ] Round half away from zero (Postgres `round(numeric)`).
- [ ] Largest remainder, ties to the smaller user id compared as code points.
- [ ] Percent and shares weights at 6 decimals; percent sums to exactly 100.
- [ ] Every expense nets to zero in group currency: convert the total once, then split.
- [ ] `fx_rate` is snapshotted on write (expense day; settlements today, UTC), inverse pair as
      fallback `round(1 / rate, 12)`. Clients never send a rate.
- [ ] Rates stay decimal text end to end on the client (`fx_rate::text`, `convert(amount, text)`,
      `invertRate`). Never `Number(rate)` before converting.
- [ ] RPCs that move a balance: share lock the group row first, then the expense or payment row.
- [ ] Nothing moves a former member's balance (`split_member_not_in_group`, `member_not_in_group`).
- [ ] Archived groups refuse writes (`private.require_unarchived`, `group_archived`).
- [ ] RPC signature or return shape unchanged; otherwise `_v2` (ADR 8).

## Tests

- [ ] `packages/core`: exact integer assertions, a `fast-check` property where it fits (sums, order
      independence). `pnpm --filter @potluck/core exec vitest run src/<area>`.
- [ ] SQL: the same cases in `supabase/tests/06_expenses.test.sql`,
      `07_balances_settlements.test.sql` or `15_integrity.test.sql` (start with `delete from public.fx_rates;`).
- [ ] Web: the screen that shows the number (`apps/web/src/features/expenses`, `balances`, `settle`).
- [ ] e2e only for a journey: `apps/web/e2e/expenses.spec.ts`, `balances.spec.ts`. Note e2e sets
      today's EUR to USD rate to 1.1 in the shared dev database.

## Finish

- [ ] `pnpm verify`; `pnpm db:reset && pnpm verify:db` if SQL changed.
- [ ] Update ADR 3 or `docs/architecture.md` if a rule changed, and the user guide
      ([Fermulate/potluck-docs](https://github.com/Fermulate/potluck-docs)) if users see it.
