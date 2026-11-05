import { moneyQueries } from '@potluck/api'
import { convert } from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/**
 * For foreign currency expenses: what it comes to in the group currency at the rate the server
 * will use. `savedRate` is the rate an edited expense keeps while its currency is unchanged;
 * otherwise this previews the latest known rate on or before `spentAt`, which the server
 * snapshots on save.
 */
export function ConversionPreview({
  amountCents,
  currency,
  groupCurrency,
  spentAt,
  savedRate,
}: {
  amountCents: number
  currency: string
  groupCurrency: string
  spentAt: string
  savedRate?: number
}) {
  const { data, isPending } = useQuery({
    ...moneyQueries.fxRate(supabase, currency, groupCurrency, spentAt),
    enabled: savedRate === undefined,
  })
  if (currency === groupCurrency) return null
  if (savedRate !== undefined) {
    return (
      <ConversionLine
        amountCents={amountCents}
        currency={currency}
        groupCurrency={groupCurrency}
        rate={savedRate}
        detail={t('expenses.conversion.savedRate', {
          from: currency,
          to: groupCurrency,
          rate: formatRate(savedRate),
        })}
      />
    )
  }
  if (isPending) return <Skeleton shape="line" className="mx-auto h-4 w-48" />
  if (!data) {
    return (
      <p role="alert" className="text-center text-sm font-medium text-tomato-ink">
        {t('expenses.conversion.unavailable', { from: currency, to: groupCurrency })}
      </p>
    )
  }
  return (
    <ConversionLine
      amountCents={amountCents}
      currency={currency}
      groupCurrency={groupCurrency}
      rate={data.rate}
      detail={`${t('expenses.conversion.rate', {
        from: currency,
        to: groupCurrency,
        rate: formatRate(data.rate),
        date: formatDate(data.day, { timeZone: 'UTC', style: 'dayMonth' }),
      })}. ${t('expenses.conversion.locked')}`}
    />
  )
}

function formatRate(rate: number): string {
  return String(Number(rate.toFixed(4)))
}

function ConversionLine({
  amountCents,
  currency,
  groupCurrency,
  rate,
  detail,
}: {
  amountCents: number
  currency: string
  groupCurrency: string
  rate: number
  detail: string
}) {
  const converted = convert(amountCents, rate, { from: currency, to: groupCurrency })
  return (
    <div className="flex flex-col items-center gap-0.5 text-center" aria-live="polite">
      <p className="inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-ink">
        <ArrowRightLeft aria-hidden className="size-4 text-mute" />
        {t('expenses.conversion.about', {
          amount: formatMoney(converted, groupCurrency),
          currency: groupCurrency,
        })}
      </p>
      <p className="text-xs text-mute">{detail}</p>
    </div>
  )
}
