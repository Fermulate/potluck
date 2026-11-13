import { app, toast, common, nav, empty, errors } from './en/shell'
import { auth, onboarding } from './en/auth'
import { groups, members, roles, invites, friends } from './en/groups'
import { expenses, categories, splitTypes, balances, settle, activity } from './en/money'
import { events, availability, bestTime, rsvp, timeline, home } from './en/plans'
import { notifications, settings, account, unsubscribe } from './en/me'
import { help } from './en/help'

/**
 * English strings. Nested by screen or domain; look them up with dotted keys via `t()`.
 *
 * Conventions:
 * - `{name}` placeholders are filled from `t(key, { name })`. Amounts and dates are passed in
 *   already formatted (see `formatMoney`, `formatDate`).
 * - Plurals use sibling keys with `_one` / `_other` (and optionally `_zero`) suffixes and are
 *   looked up by their base key with a numeric `count`: `t('groups.memberCount', { count })`.
 * - Voice ("Supper Club"): warm, a little witty, short. No em or en dashes.
 * - Each feature owns a file in `./en/`. Add keys there, not here.
 */
export const en = {
  app,
  toast,
  common,
  nav,
  auth,
  onboarding,
  home,
  groups,
  members,
  roles,
  invites,
  friends,
  expenses,
  categories,
  splitTypes,
  balances,
  settle,
  events,
  availability,
  bestTime,
  rsvp,
  timeline,
  activity,
  notifications,
  settings,
  account,
  unsubscribe,
  help,
  empty,
  errors,
} as const

export type Dictionary = typeof en
