import { DEFAULT_LOCALE } from '@potluck/i18n'
import { Amount, type AmountProps } from '@potluck/ui'

/** `Amount` pinned to the app locale, so it matches `formatMoney` text ($12.00, not US$12.00). */
export function Money({ locale, ...props }: AmountProps) {
  return <Amount locale={locale ?? DEFAULT_LOCALE} {...props} />
}
