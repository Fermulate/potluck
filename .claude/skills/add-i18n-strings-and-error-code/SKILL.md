---
name: add-i18n-strings-and-error-code
description: Add user-facing copy, a new i18n namespace, or a new database error code with its translated message in Potluck. Use whenever UI text changes or an RPC raises a new code.
---

# Strings and error codes

## Copy

1. Pick the feature file in `packages/i18n/src/en/` (`shell`, `auth`, `groups`, `money`, `plans`, `me`,
   `help`). Namespaces and their files: `docs/agent-map.json` (`i18nNamespaces`).
2. Add the key there, never in `en.ts`. Placeholders `{name}`; pass formatted values
   (`formatMoney(cents, currency)`, `formatDate(day, { timeZone })`).
3. Plurals: `key_one` and `key_other` (optional `key_zero`), `_other` contains `{count}`; call
   `t('ns.key', { count })`.
4. Voice: warm, a little witty, short. No em or en dashes.
5. Use it: `t('expenses.paidSummary', { name, amount })`. Typecheck fails on a wrong key or missing
   placeholder.
6. New top-level namespace: export it from the feature file, then one import and one entry in
   `packages/i18n/src/en.ts`.

## A new error code from SQL

1. Raise it: `raise exception using message = '<snake_code>', detail = '<English>', errcode = '<state>'`
   (`42501` auth, `PT404` not found, `22023` input, `23514` rule).
2. Wording, by who shows it (`errorMessage(error, scope)` in `apps/web/src/lib/errors.ts` tries the
   scope, then auth codes, then `errors.codes`):
   - expense, payment or split screens: `expenses.errors.<code>` in `en/money.ts`;
   - plan screens: `events.errors.<code>` in `en/plans.ts`;
   - anywhere else: `errors.codes.<code>` in `en/shell.ts`.
3. Add the code to the right group in "Errors" in `docs/architecture.md`.
4. Make sure the screen passes the scope: `errorMessage(error, 'expenses.errors')`.
5. Check:

```sh
pnpm --filter @potluck/web exec vitest run src/lib/server-codes.test.ts src/lib/errors.test.ts
pnpm --filter @potluck/i18n test
pnpm gen:map   # refreshes errorCodes in docs/agent-map.json (after pnpm gen:schema if SQL changed)
```

`server-codes.test.ts` fails when any code raised in a migration has no wording or is missing from the
docs list.

## Client-only codes

Split errors from core go in `errors.split.<code>`, schema validation codes in
`errors.validation.<code>`; `dictionary.test.ts` lists the ones it requires.
