import type { Dictionary } from './en'
import type { Translation } from './locales'
import { app, toast, common, nav, empty, errors } from './fr/shell'
import { auth, onboarding } from './fr/auth'
import { groups, members, roles, invites, friends } from './fr/groups'
import { expenses, categories, splitTypes, balances, settle, activity } from './fr/money'
import { events, availability, bestTime, rsvp, timeline, home, guests } from './fr/plans'
import { notifications, settings, account, unsubscribe, security } from './fr/me'
import { help } from './fr/help'
import { search, filters, insights, deletedItems, activityFilter } from './fr/insights'
import { people } from './fr/people'

/**
 * French (tu, written for France and other French-speaking places). Same files and keys as `./en`; a key missing here shows in English. Loaded on demand
 * by `setLocale('fr')`.
 */
export const fr = {
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
  guests,
  timeline,
  activity,
  notifications,
  settings,
  account,
  unsubscribe,
  security,
  help,
  search,
  filters,
  insights,
  deletedItems,
  activityFilter,
  people,
  empty,
  errors,
} satisfies Translation<Dictionary>
