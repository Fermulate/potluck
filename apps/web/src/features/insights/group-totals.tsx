import { insightsQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, EmptyState, Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { History, Plus, Trash2 } from 'lucide-react'
import { groupTitle, todayIn } from '@/features/expenses/format'
import { useGroupMoneyRealtime, useMoneyGroup, useTimeZone } from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { LoadProblem } from './load-problem'
import { hasLoadProblem } from './load-state'
import { NavRow } from './nav-row'
import { SpendingView } from './spending-view'

export function TotalsSkeleton() {
  return (
    <div aria-busy="true" aria-label={t('insights.loading')} className="flex flex-col gap-5">
      <Skeleton shape="line" className="h-9 w-56" />
      <Skeleton className="h-64" />
      <Skeleton className="h-56" />
    </div>
  )
}

/** A group's Totals tab: what the group spent and the viewer's part of it, with charts. */
export function GroupTotals({ groupId }: { groupId: string }) {
  useGroupMoneyRealtime(groupId)
  const timeZone = useTimeZone()
  const group = useMoneyGroup(groupId)
  const me = useUserId()
  const summary = useQuery(insightsQueries.groupSpending(supabase, groupId))
  const thisMonth = `${todayIn(timeZone).slice(0, 7)}-01`

  const links = (
    <div className="flex flex-col gap-3">
      <NavRow
        to="/activity"
        search={{ groupId }}
        icon={<History />}
        title={t('insights.links.activity')}
        hint={t('insights.links.activityHint')}
      />
      <NavRow
        to="/groups/$groupId/deleted"
        params={{ groupId }}
        icon={<Trash2 />}
        tone="tomato"
        title={t('insights.links.deleted')}
        hint={t('insights.links.deletedHint')}
      />
    </div>
  )

  if (hasLoadProblem(summary)) return <LoadProblem query={summary} />
  if (summary.isPending || group.isPending) return <TotalsSkeleton />

  if (!summary.data?.length || !group.data) {
    const archived = !!group.data?.archived_at
    return (
      <div className="flex flex-col gap-5">
        <EmptyState
          illustration="📊"
          title={t('insights.empty.title')}
          description={
            archived && group.data
              ? t('expenses.form.archived', { group: groupTitle(group.data, me) })
              : t('insights.empty.body')
          }
          action={
            archived ? undefined : (
              <Button asChild leadingIcon={<Plus />}>
                <Link to="/new/expense" search={{ groupId }}>
                  {t('empty.expenses.action')}
                </Link>
              </Button>
            )
          }
        />
        {links}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <SpendingView
        rows={summary.data}
        currency={group.data.currency}
        thisMonth={thisMonth}
        help={<Help topic="totals" />}
      />
      {links}
    </div>
  )
}
