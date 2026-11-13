import type { SpendingSummaryRow } from '@potluck/api'
import {
  nextMonth,
  previousMonth,
  spendingByCategory,
  spendingByGroup,
  spendingByMonth,
  spendingTotals,
  type SpendingTotals,
} from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Card, cn, IconButton, SegmentedControl } from '@potluck/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Money } from '@/features/expenses/money'
import { categoryEmoji, categoryLabel } from '@/features/expenses/format'
import { BarList, ChartCard, DataTable, MonthColumns } from './charts'
import { monthLabel } from './months'
import { chartMonths, rowsInPeriod, type Period } from './period'

type Measure = 'shareCents' | 'spendCents'

function PeriodControl({
  period,
  onChange,
  thisMonth,
}: {
  period: Period
  onChange: (p: Period) => void
  thisMonth: string
}) {
  const step = (dir: 1 | -1) => {
    let month = period.month
    const times = period.kind === 'year' ? 12 : 1
    for (let i = 0; i < times; i++) month = dir === 1 ? nextMonth(month) : previousMonth(month)
    onChange({ ...period, month })
  }
  const label =
    period.kind === 'month'
      ? monthLabel(period.month)
      : period.kind === 'year'
        ? period.month.slice(0, 4)
        : t('insights.period.allTime')
  const atEnd =
    period.kind === 'month'
      ? period.month >= thisMonth
      : period.kind === 'year' && period.month.slice(0, 4) >= thisMonth.slice(0, 4)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl
        label={t('insights.period.label')}
        size="sm"
        value={period.kind}
        onValueChange={(kind) => onChange({ kind, month: period.month })}
        options={[
          { value: 'month', label: t('insights.period.month') },
          { value: 'year', label: t('insights.period.year') },
          { value: 'all', label: t('insights.period.all') },
        ]}
      />
      <div className="flex items-center gap-1">
        {period.kind !== 'all' && (
          <IconButton
            label={t('insights.period.previous')}
            icon={<ChevronLeft />}
            size="sm"
            variant="ghost"
            onClick={() => step(-1)}
          />
        )}
        <p aria-live="polite" className="min-w-[8.5rem] text-center text-[0.9375rem] font-semibold">
          {label}
        </p>
        {period.kind !== 'all' && (
          <IconButton
            label={t('insights.period.next')}
            icon={<ChevronRight />}
            size="sm"
            variant="ghost"
            disabled={atEnd}
            onClick={() => step(1)}
          />
        )}
      </div>
    </div>
  )
}

function TotalsCard({
  totals,
  currency,
  allGroups,
}: {
  totals: SpendingTotals
  currency: string
  allGroups: boolean
}) {
  const money = (cents: number) => formatMoney(cents, currency)
  const net = totals.netCents
  const items: [string, number][] = [
    [allGroups ? t('insights.totals.spendAll') : t('insights.totals.spend'), totals.spendCents],
    [t('insights.totals.paid'), totals.paidCents],
    [t('insights.totals.made'), totals.paymentsMadeCents],
    [t('insights.totals.received'), totals.paymentsReceivedCents],
  ]
  return (
    <Card padding="roomy" aria-label={t('insights.totals.label')} role="region">
      <p className="text-sm font-semibold text-mute">{t('insights.totals.hero')}</p>
      <p className="mt-1 text-5xl leading-none font-extrabold tracking-[-0.03em]">
        <Money cents={totals.shareCents} currency={currency} tone="neutral" countUp />
      </p>
      <p className="mt-2 text-sm text-mute">
        {t('insights.totals.expenses', { count: totals.expenseCount })}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
        {items.map(([label, cents]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-mute">{label}</dt>
            <dd className="text-lg font-bold tabular-nums">{money(cents)}</dd>
          </div>
        ))}
        <div className="col-span-2 flex items-baseline justify-between gap-3 rounded-[0.75rem] bg-sunken px-3 py-2.5">
          <dt className="text-sm font-semibold">{t('insights.totals.net')}</dt>
          <dd
            className={cn(
              'text-[0.9375rem] font-bold tabular-nums',
              net > 0 ? 'text-saffron-ink' : net < 0 ? 'text-tomato-ink' : 'text-mute',
            )}
          >
            {net > 0
              ? t('insights.totals.netUp', { amount: money(net) })
              : net < 0
                ? t('insights.totals.netDown', { amount: money(-net) })
                : t('insights.totals.netNone')}
          </dd>
        </div>
      </dl>
    </Card>
  )
}

export interface GroupInfo {
  id: string
  name: string
  emoji: string | null
}

/**
 * Totals, by month and by category (and by group across groups) for one currency's rows. The
 * caller picks the rows: one group's, or every group's in one currency.
 */
export function SpendingView({
  rows,
  currency,
  thisMonth,
  groups,
  help,
}: {
  rows: readonly SpendingSummaryRow[]
  currency: string
  /** `YYYY-MM-01` of today in the viewer's zone. */
  thisMonth: string
  /** Across groups: names for the by-group chart. */
  groups?: Map<string, GroupInfo>
  /** A help link beside the period picker. */
  help?: ReactNode
}) {
  const [period, setPeriod] = useState<Period>({ kind: 'month', month: thisMonth })
  const [measure, setMeasure] = useState<Measure>('shareCents')
  const measureLabel =
    measure === 'shareCents' ? t('insights.byMonth.share') : t('insights.byMonth.spend')
  const money = (cents: number) => formatMoney(cents, currency)

  const inPeriod = useMemo(() => rowsInPeriod(rows, period), [rows, period])
  const totals = useMemo(() => spendingTotals(inPeriod), [inPeriod])

  const months = useMemo(() => {
    const { from, to } = chartMonths(rows, period, thisMonth)
    const filled = new Map(
      spendingByMonth(rows.filter((r) => r.month >= from && r.month <= to)).map((b) => [
        b.key,
        b.totals[measure],
      ]),
    )
    const out: { month: string; cents: number }[] = []
    for (let month = from; month <= to; month = nextMonth(month)) {
      out.push({ month, cents: filled.get(month) ?? 0 })
    }
    return out
  }, [rows, period, thisMonth, measure])

  const categories = useMemo(() => spendingByCategory(inPeriod, measure), [inPeriod, measure])
  const byGroup = useMemo(
    () =>
      groups
        ? spendingByGroup(inPeriod)
            .filter((b) => b.totals[measure] !== 0)
            // Largest first by what the bars show (the share, or what everyone spent).
            .sort((a, b) => b.totals[measure] - a.totals[measure])
        : [],
    [groups, inPeriod, measure],
  )

  const measureControl = (
    <SegmentedControl
      label={t('insights.byMonth.measure')}
      size="sm"
      value={measure}
      onValueChange={setMeasure}
      options={[
        { value: 'shareCents', label: t('insights.byMonth.share') },
        { value: 'spendCents', label: t('insights.byMonth.spend') },
      ]}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PeriodControl period={period} onChange={setPeriod} thisMonth={thisMonth} />
        </div>
        {help && <div className="pt-1">{help}</div>}
      </div>
      <TotalsCard totals={totals} currency={currency} allGroups={Boolean(groups)} />
      {totals.expenseCount === 0 &&
        totals.paymentsMadeCents + totals.paymentsReceivedCents === 0 && (
          <p className="px-1 text-sm text-mute">{t('insights.empty.period')}</p>
        )}

      <ChartCard
        title={t('insights.byMonth.title')}
        action={measureControl}
        table={
          <DataTable
            caption={t('insights.byMonth.title')}
            head={[t('insights.table.month'), measureLabel]}
            rows={months.map((m) => ({
              key: m.month,
              label: monthLabel(m.month),
              amount: money(m.cents),
            }))}
          />
        }
      >
        <MonthColumns
          data={months}
          currency={currency}
          measureLabel={measureLabel}
          selected={period.kind === 'month' ? period.month : null}
          onSelect={(month) => setPeriod({ kind: 'month', month })}
        />
        <p className="text-xs text-mute">{t('insights.byMonth.selectHint')}</p>
      </ChartCard>

      <ChartCard title={t('insights.byCategory.title')}>
        {categories.length === 0 ? (
          <p className="text-sm text-mute">{t('insights.byCategory.empty')}</p>
        ) : (
          <BarList
            label={t('insights.byCategory.title')}
            currency={currency}
            data={categories.map((c) => ({
              key: c.key,
              name: categoryLabel(c.key),
              label: (
                <>
                  <span aria-hidden className="text-lg leading-none">
                    {categoryEmoji(c.key)}
                  </span>
                  <span className="truncate">{categoryLabel(c.key)}</span>
                </>
              ),
              cents: c.totals[measure],
            }))}
          />
        )}
      </ChartCard>

      {groups && byGroup.length > 0 && (
        <ChartCard title={t('insights.byGroup.title')}>
          <BarList
            label={t('insights.byGroup.title')}
            currency={currency}
            data={byGroup.map((b) => {
              const g = groups.get(b.key)
              const name = g?.name ?? ''
              return {
                key: b.key,
                name,
                label: (
                  <>
                    <span aria-hidden className="text-lg leading-none">
                      {g?.emoji ?? '🍲'}
                    </span>
                    <span className="truncate">{name}</span>
                  </>
                ),
                cents: b.totals[measure],
                // The link reads as its visible text (name, amount, share), so voice control
                // and screen readers agree on it.
                link: { to: '/groups/$groupId/totals', params: { groupId: b.key } } as never,
              }
            })}
          />
        </ChartCard>
      )}
    </div>
  )
}
