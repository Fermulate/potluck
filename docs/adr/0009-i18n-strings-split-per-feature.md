# 9. i18n strings split per feature

- Status: accepted
- Date: 2026-11-05

## Context

All user-facing text goes through `packages/i18n`, English only for now. The first version was one `en.ts` file. With several features in flight at once, every branch would edit that one file, and most merges would conflict there. We also wanted typos in keys and missing placeholders caught at compile time, and plurals that work in other languages later.

## Decision

- Each feature owns a file in `packages/i18n/src/en/`: `shell.ts`, `auth.ts`, `groups.ts`, `money.ts`, `plans.ts`, `me.ts`. A file exports one or more namespaces (`money.ts` has `expenses`, `categories`, `splitTypes`, `balances`, `settle`, `activity`).
- `en.ts` only assembles those namespaces into the `en` dictionary. New keys go in the feature file.
- Strings are looked up with dotted keys through `t()`. `MessageKey` and `MessageParams` are derived from the dictionary type, so an unknown key or a missing `{placeholder}` is a type error.
- Plurals use `_zero`, `_one` and `_other` sibling keys, resolved with `Intl.PluralRules`.
- Amounts and dates are formatted before they go into a string, with `formatMoney` and `formatDate`.
- Server errors are codes (`splits_sum_mismatch`), and the `errors` namespace translates them.

## Consequences

- Features can add strings in parallel without conflicts.
- Typed keys catch mistakes in CI rather than in front of users.
- The `Dictionary` type gets large, and very deep key unions can slow down the TypeScript language server.
- Adding a second language means a parallel tree of files with the same shape. Nothing loads languages lazily yet.
