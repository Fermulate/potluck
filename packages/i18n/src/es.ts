import type { Dictionary } from './en'
import type { Translation } from './locales'
import { app, toast, common, nav, empty, errors } from './es/shell'
import { auth, onboarding } from './es/auth'
import { groups, members, roles, invites, friends } from './es/groups'
import { expenses, categories, splitTypes, balances, settle, activity } from './es/money'
import { events, availability, bestTime, rsvp, timeline, home } from './es/plans'
import { notifications, settings, account, unsubscribe, security } from './es/me'
import { help } from './es/help'

/**
 * Spanish (tú, neutral Latin American and Spain friendly). Same files and keys as `./en`; a key
 * missing here shows in English. Loaded on demand by `setLocale('es')`.
 */
export const es = {
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
  security,
  help,
  empty,
  errors,
} satisfies Translation<Dictionary>
