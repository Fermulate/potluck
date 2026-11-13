import type { Dictionary } from './en'
import type { Translation } from './locales'
import { app, toast, common, nav, empty, errors } from './pt/shell'
import { auth, onboarding } from './pt/auth'
import { groups, members, roles, invites, friends } from './pt/groups'
import { expenses, categories, splitTypes, balances, settle, activity } from './pt/money'
import { events, availability, bestTime, rsvp, timeline, home } from './pt/plans'
import { notifications, settings, account, unsubscribe, security } from './pt/me'
import { help } from './pt/help'

/**
 * Portuguese (você, written to read naturally in Brazil and Portugal). Same files and keys as `./en`; a key missing here shows in English. Loaded on demand
 * by `setLocale('pt')`.
 */
export const pt = {
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
