import { insightsKeys, insightsQueries } from '@potluck/api'
import { spendingCurrencies, spendingTotals } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Button, EmptyState, PageHeader, Select } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { groupTitle, todayIn } from '@/features/expenses/format'
import { useTimeZone, useViewer } from '@/features/expenses/money-data'
import { useMyGroups, useMyGroupsRealtime } from '@/features/groups/use-groups'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { TotalsSkeleton } from './group-totals'
import { LoadProblem } from './load-problem'
import { hasLoadProblem } from './load-state'
import { SpendingView, type GroupInfo } from './spending-view'

const LIVE_TABLES = [{ table: 'expenses' }, { table: 'settlements' }]
const liveKeys = () => [insightsKeys.all]

/** `all:USD` shows everything converted into USD; `only:EUR` shows just the EUR groups. */
type View = `all:${string}` | `only:${string}`

/**
 * Spending across every group. With groups in several currencies it opens with everything
 * converted into the viewer's default currency (each amount at its own date, the rule
 * expenses use), and each currency can still be seen on its own, unconverted.
 */
export function SpendingScreen() {
  useMyGroupsRealtime('insights-live', LIVE_TABLES, liveKeys)
  const me = useUserId()
  const timeZone = useTimeZone()
  const viewer = useViewer()
  const native = useQuery(insightsQueries.spending(supabase))
  const groups = useMyGroups()
  const thisMonth = `${todayIn(timeZone).slice(0, 7)}-01`

  const currencies = useMemo(() => spendingCurrencies(native.data ?? []), [native.data])
  const target = viewer.data?.default_currency ?? currencies[0]
  // One currency that is already the viewer's: nothing to convert or choose.
  const single = currencies.length === 1 && currencies[0] === target
  const [picked, setPicked] = useState<View | null>(null)
  const views: View[] = target
    ? [`all:${target}`, ...currencies.map((c): View => `only:${c}`)]
    : currencies.map((c): View => `only:${c}`)
  const view: View | undefined =
    picked && views.includes(picked) ? picked : single ? `only:${target}` : views[0]
  const converting = !!view?.startsWith('all:') && !single
  const currency = view?.slice(view.indexOf(':') + 1)

  const converted = useQuery({
    ...insightsQueries.spending(supabase, null, null, target ?? null),
    enabled: converting && !!target && currencies.length > 0,
  })
  const source = converting ? converted : native
  const rows = useMemo(
    () => (source.data ?? []).filter((r) => r.currency === currency),
    [source.data, currency],
  )
  const unconverted = converting ? spendingTotals(rows).unconvertedCount : 0
  // Name what was left out: each group with something unconverted, and its currency.
  const leftOut = useMemo(() => {
    if (!converting) return ''
    const ids = [...new Set(rows.filter((r) => r.unconvertedCount > 0).map((r) => r.groupId))]
    return ids
      .map((id) => {
        const g = groups.data?.find((x) => x.id === id)
        return g
          ? t('insights.unconvertedGroup', { group: groupTitle(g, me), currency: g.currency })
          : null
      })
      .filter((name): name is string => !!name)
      .join(', ')
  }, [converting, rows, groups.data, me])
  const groupInfo = useMemo(
    () =>
      new Map<string, GroupInfo>(
        (groups.data ?? []).map((g) => [
          g.id,
          { id: g.id, name: groupTitle(g, me), emoji: g.is_direct ? '🤝' : g.emoji },
        ]),
      ),
    [groups.data, me],
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <PageHeader
        flourish={t('insights.flourish')}
        title={t('insights.title')}
        subtitle={t('insights.subtitle')}
        actions={<Help topic="totals" />}
      />
      <div className="mt-6">
        {hasLoadProblem(native) ? (
          <LoadProblem query={native} />
        ) : native.isPending ? (
          <TotalsSkeleton />
        ) : !currency || currencies.length === 0 ? (
          <EmptyState
            illustration="📊"
            title={t('insights.empty.title')}
            description={t('insights.empty.body')}
            action={
              <Button asChild leadingIcon={<Plus />}>
                <Link to="/new/expense">{t('empty.expenses.action')}</Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {!single && (
              <div className="flex flex-col gap-1.5">
                <Select
                  label={t('insights.view')}
                  value={view}
                  onValueChange={(v) => setPicked(v as View)}
                  options={views.map((v) => {
                    const code = v.slice(v.indexOf(':') + 1)
                    return {
                      value: v,
                      label: v.startsWith('all:')
                        ? t('insights.convertedTo', { currency: code })
                        : t('insights.onlyCurrency', { currency: code }),
                    }
                  })}
                  className="sm:w-80"
                />
                <p className="text-sm text-mute">
                  {converting ? t('insights.convertedNote') : t('insights.currencyNote')}
                </p>
                {unconverted > 0 && (
                  <p className="text-sm font-semibold text-tomato-ink">
                    {t('insights.unconverted', { count: unconverted, list: leftOut })}
                  </p>
                )}
              </div>
            )}
            {converting && hasLoadProblem(converted) ? (
              <LoadProblem query={converted} />
            ) : converting && converted.isPending ? (
              <TotalsSkeleton />
            ) : (
              <SpendingView
                key={view}
                rows={rows}
                currency={currency}
                thisMonth={thisMonth}
                groups={groupInfo}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
