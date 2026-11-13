import { formatDate } from '@potluck/i18n'

/** "March 2026" for a `YYYY-MM-01` month. */
export const monthLabel = (month: string) =>
  formatDate(month, { timeZone: 'UTC', style: 'monthYear' })

/** "Mar" for a `YYYY-MM-01` month. */
export const monthShort = (month: string) =>
  formatDate(month, { timeZone: 'UTC', style: 'monthShort' })
