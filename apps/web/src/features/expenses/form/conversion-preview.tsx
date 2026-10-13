import { moneyQueries } from '@potluck/api'
import { convert } from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * For foreign currency expenses: what it comes to in the group currency at the latest known
 * rate. Only a preview; the server snapshots the real rate on save.
 */
export function ConversionPreview({
  amountCents,
  currency,
  groupCurrency,
}: {
  amountCents: number
  currency: string
  groupCurrency: string
}) {
  const { data, isPending } = useQuery(moneyQueries.fxRate(supabase, currency, groupCurrency))
  if (currency === groupCurrency) return null
  if (isPending) return <Skeleton shape="line" className="mx-auto h-4 w-48" />
  if (!data) {
    return (
      <p role="alert" className="text-center text-sm font-medium text-tomato-ink">
        {t('expenses.conversion.unavailable', { from: currency, to: groupCurrency })}
      </p>
    )
  }
  const converted = convert(amountCents, data.rate, { from: currency, to: groupCurrency })
  return (
    <div className="flex flex-col items-center gap-0.5 text-center" aria-live="polite">
      <p className="inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-ink">
        <ArrowRightLeft aria-hidden className="size-4 text-mute" />
        {t('expenses.conversion.about', {
          amount: formatMoney(converted, groupCurrency),
          currency: groupCurrency,
        })}
      </p>
      <p className="text-xs text-mute">
        {t('expenses.conversion.rate', {
          from: currency,
          to: groupCurrency,
          rate: String(Number(data.rate.toFixed(4))),
          date: data.day ? formatDate(data.day, { timeZone: 'UTC', style: 'dayMonth' }) : '',
        })}
        . {t('expenses.conversion.locked')}
      </p>
    </div>
  )
}
