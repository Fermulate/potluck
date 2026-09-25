/**
 * English strings. Nested by screen or domain; look them up with dotted keys via `t()`.
 *
 * Conventions:
 * - `{name}` placeholders are filled from `t(key, { name })`.
 * - Plurals use sibling keys with `_one` / `_other` (and optionally `_zero`) suffixes and are
 *   looked up by their base key with a numeric `count`: `t('groups.memberCount', { count })`.
 * - Voice ("Supper Club"): warm, a little witty, short. No em or en dashes.
 */
export const en = {
  app: {
    name: 'Potluck',
  },
  home: {
    greeting: {
      evening: 'Evening, {name}.',
    },
  },
  groups: {
    memberCount_one: '{count} member',
    memberCount_other: '{count} members',
  },
  expenses: {
    count_zero: 'No expenses yet',
    count_one: '{count} expense',
    count_other: '{count} expenses',
  },
} as const

export type Dictionary = typeof en
