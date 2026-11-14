import type { SplitTypeValue } from '@potluck/api'
import { docsUrl } from '@/lib/docs'

/**
 * Where each help affordance points in the user guide. Paths are guide page slugs plus the
 * heading anchor the guide generates (the heading text, lowercased and hyphenated).
 */
export const HELP_TOPICS = {
  splitEqual: '/expenses/splits/#equal',
  splitExact: '/expenses/splits/#exact',
  splitPercent: '/expenses/splits/#percent',
  splitShares: '/expenses/splits/#shares',
  splitItemized: '/expenses/splits/#by-item',
  splitAdjustment: '/expenses/splits/#adjustment',
  defaultSplit: '/expenses/splits/#default-split',
  payers: '/expenses/#several-people-paid',
  refunds: '/expenses/#refunds',
  rounding: '/expenses/splits/#how-rounding-works',
  currencies: '/expenses/currencies/#add-an-expense-in-another-currency',
  exchangeRates: '/expenses/currencies/#where-the-rates-come-from',
  recurring: '/expenses/recurring/#make-an-expense-repeat',
  recurringEdit: '/expenses/recurring/#see-and-manage-repeating-expenses',
  receipts: '/expenses/receipts/#who-can-see-a-receipt',
  receiptScan: '/expenses/receipts/#scan-a-receipt',
  simplifiedDebts: '/balances/#simplified-debts',
  settleUp: '/balances/settle-up/#settle-up',
  paymentLinks: '/balances/settle-up/#pay-with-an-app',
  remind: '/balances/settle-up/#remind-someone',
  settleEverything: '/balances/settle-up/#settle-everything-at-once',
  settleFriend: '/balances/settle-up/#settle-up-with-a-friend-across-groups',
  paymentMethods: '/account/#payment-methods',
  roles: '/groups/roles/#who-can-do-what',
  invites: '/groups/invites/#change-what-a-link-allows',
  houseRules: '/groups/settings/#house-rules',
  painter: '/plans/availability/#mouse-touch-and-keyboard',
  heatmap: '/plans/availability/#the-live-heatmap',
  guestLinks: '/plans/availability/#guest-links',
  bestTimes: '/plans/best-time/#the-rules',
  lockIn: '/plans/lock-in/#lock-it-in',
  calendarFeed: '/account/#calendar-feed',
  push: '/notifications/#turn-on-push-notifications',
  deleteAccount: '/account/#what-happens-to-shared-tabs',
  twoFactor: '/account/#two-step-sign-in',
  search: '/expenses/search-and-totals/#search-everything',
  totals: '/expenses/search-and-totals/#totals-and-charts',
  restore: '/expenses/editing/#undo-and-restore',
  placeholders: '/groups/#people-not-on-potluck-yet',
  friends: '/friends/#add-a-friend',
  yourData: '/account/#export-your-data',
  importExpenses: '/groups/settings/#import-expenses',
  groupTypes: '/groups/settings/#group-type',
  restoreGroup: '/groups/settings/#restore-a-deleted-group',
  notes: '/groups/#group-notes',
  categories: '/expenses/#categories',
} as const satisfies Record<string, `/${string}`>

export type HelpTopic = keyof typeof HELP_TOPICS

/** Full URL of a topic in the guide. */
export function helpHref(topic: HelpTopic): string {
  return docsUrl(HELP_TOPICS[topic])
}

export const SPLIT_HELP: Record<SplitTypeValue, HelpTopic> = {
  equal: 'splitEqual',
  exact: 'splitExact',
  percent: 'splitPercent',
  shares: 'splitShares',
  adjustment: 'splitAdjustment',
  itemized: 'splitItemized',
}

/** Whole guide pages the app links to: the Help section on Me, and privacy from sign up. */
export const HELP_PAGES = {
  gettingStarted: '/getting-started/',
  privacy: '/privacy-and-security/',
  faq: '/faq/',
  troubleshooting: '/troubleshooting/',
  guide: '/',
} as const satisfies Record<string, `/${string}`>
