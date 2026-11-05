/**
 * Strings and formatting. Platform-neutral (Intl only, no DOM).
 */
export {
  formatDate,
  formatDateRange,
  formatRelative,
  formatTime,
  type DateFormatOptions,
  type DateInput,
  type DateStyle,
} from './dates'
export { en, type Dictionary } from './en'
export { greeting } from './greeting'
export { DEFAULT_LOCALE, formatMoney, type MoneyFormatOptions } from './money'
export { hasMessage, t, type MessageKey, type MessageParams } from './translate'
