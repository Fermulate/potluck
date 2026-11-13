# packages/i18n

Every user-facing string, `t()`, and the money and date formatters. English is the source; Spanish,
French, German and Portuguese are translations. Root rules: [../../AGENTS.md](../../AGENTS.md). Full
recipe: the `add-i18n-strings-and-error-code` skill.

- Languages are listed in `src/locales.ts` and loaded in `src/load.ts`. `src/<code>/<feature>.ts`
  mirrors `src/en/<feature>.ts`, typed `satisfies Translation<typeof en.x>` (a key English lacks fails
  typecheck), and `src/<code>.ts` gathers them. A key a language leaves out shows in English.
- `locales.test.ts` checks every language: placeholders, plurals, dashes, no stray keys, and coverage
  of at least 97% of English (the failure lists what is missing). A new English key should come with
  its translations; the margin only keeps a parallel branch from failing the build.
- `setLocale(code)` loads a language (dynamic import, so English pages never download it) and switches
  `t()`, plural rules, date and money formats. `t()` reads the language when called: never keep its
  result in module scope. A date format kept in module scope goes through `localDateFormat()`.
- Lines about the viewer: a new activity verb needs `activity.self.<verb>` (the viewer did it) and,
  if it names someone, `activity.toYou.<verb>` (done to the viewer), in English and every
  language; `locales.test.ts` fails without them. Elsewhere, pick a "you" key (`expenses.youPaid`,
  `balances.youOwe`) instead of filling a name placeholder with "You".
- Push copy for the `notify` edge function lives in `supabase/functions/notify/copy.ts` (functions
  cannot import this package); add a language there too.

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
  `formatDate` and `formatMoney` use the active language unless given a `locale` (`DEFAULT_LOCALE` is
  for screens that stay English, like the landing demo).
- No DOM or browser globals; `Intl` only. Coverage threshold 90% (`vitest.config.ts`).
