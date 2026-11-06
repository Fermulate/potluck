# packages/i18n

Every user-facing string, `t()`, and the money and date formatters. English only for now.
Root rules: [../../AGENTS.md](../../AGENTS.md). Full recipe: the `add-i18n-strings-and-error-code` skill.

- Add keys to the feature file in `src/en/` (`shell.ts`, `auth.ts`, `groups.ts`, `money.ts`, `plans.ts`,
  `me.ts`, `help.ts`), never to `src/en.ts`. A new top-level namespace needs one import and one entry
  in `en.ts` ([ADR 9](../../docs/adr/0009-i18n-strings-split-per-feature.md)).
- Keys are typed: `t('expenses.paidSummary', { name, amount })`. A missing key or placeholder fails
  `pnpm typecheck`. Placeholders are `{name}`; pass values already formatted (`formatMoney`, `formatDate`).
- Plurals: `_one` / `_other` (optional `_zero`) siblings, looked up by the base key with `{ count }`;
  `_other` must use `{count}`.
- Voice: warm, a little witty, short (notes at the top of `src/en.ts`, [docs/design.md](../../docs/design.md)).
  No em or en dashes: `dictionary.test.ts` fails on them.
- Server error codes: wording goes in `expenses.errors` (`en/money.ts`) or `events.errors` (`en/plans.ts`)
  when one screen owns it, else `errors.codes` (`en/shell.ts`). `apps/web/src/lib/server-codes.test.ts`
  fails for a code raised in a migration without wording.
- Formatters never read the host zone or locale: `formatDate` needs an explicit `timeZone`.
- No DOM or browser globals; `Intl` only. Coverage threshold 90% (`vitest.config.ts`).
