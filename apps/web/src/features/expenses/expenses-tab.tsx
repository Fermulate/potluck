import {
  dayKey,
  matchesExpenseFilters,
  matchesPaymentFilters,
  noFilters,
  viewerShare,
} from '@potluck/core'
import type { ExpenseWithSplits, Settlement } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Download, Plus, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useUserId } from '@/lib/auth'
import { ActivityIconLink } from '@/features/activity/activity-link'
import { ActiveFilterChips, FilterButton, FilterSheet } from '@/features/insights/filter-sheet'
import { activeFilters, withoutFilter, type MoneyFilters } from '@/features/insights/filter-state'
import { useGroupExport } from '@/features/export-import/use-exports'
import { useTabSplitNote } from '@/features/friends/split-note'
import { HomeStarters } from '@/features/groups/home-starters'
import { RecurringSection } from '@/features/recurring/recurring-section'
import { SettlementActions } from '@/features/settle/settlement-actions'
import { payersOf, settlementText } from './expense-math'
import { ExpenseRow, SettlementRow } from './expense-row'
import { categoryEmoji, categoryLabel, dayLabel, groupByDay, groupTitle, todayIn } from './format'
import {
  useGroupExpenses,
  useGroupMoneyRealtime,
  useGroupSettlements,
  useMoneyGroup,
  useNameOf,
  useTimeZone,
} from './money-data'

type FeedItem =
  | { kind: 'expense'; day: string; at: string; expense: ExpenseWithSplits }
  | { kind: 'settlement'; day: string; at: string; settlement: Settlement }

export function ExpensesTab({
  groupId,
  filters,
  onFiltersChange: setFilters,
}: {
  groupId: string
  /** Kept by the caller (the route keeps them in the address). */
  filters: MoneyFilters
  onFiltersChange: (next: MoneyFilters) => void
}) {
  useGroupMoneyRealtime(groupId)
  const me = useUserId()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const reduced = usePrefersReducedMotion()
  const group = useMoneyGroup(groupId)
  const expenses = useGroupExpenses(groupId)
  const settlements = useGroupSettlements(groupId)
  const [query, setQuery] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const search = useDeferredValue(query.trim().toLocaleLowerCase())
  const selectedCategories = filters.categories ?? []
  const today = todayIn(timeZone)

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const e of expenses.data ?? []) seen.add(e.category ?? 'other')
    return [...seen].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
  }, [expenses.data])

  const expenseData = expenses.data
  const settlementData = settlements.data
  const { sections, matched } = useMemo(() => {
    const items: FeedItem[] = []
    const matched: ExpenseWithSplits[] = []
    for (const expense of filters.kind === 'payment' ? [] : (expenseData ?? [])) {
      const filterable = {
        paidBy: expense.paid_by,
        payers: payersOf(expense).map((p) => ({ userId: p.user_id })),
        spentAt: expense.spent_at,
        category: expense.category,
        splits: expense.expense_splits.map((s) => ({ userId: s.user_id })),
      }
      if (!matchesExpenseFilters(filterable, filters)) continue
      if (search) {
        const haystack = [
          expense.description,
          expense.notes ?? '',
          categoryLabel(expense.category),
          ...payersOf(expense).map((p) => nameOf(p.user_id)),
        ]
          .join(' ')
          .toLocaleLowerCase()
        if (!haystack.includes(search)) continue
      }
      items.push({ kind: 'expense', day: expense.spent_at, at: expense.created_at, expense })
      matched.push(expense)
    }
    for (const settlement of filters.kind === 'expense' ? [] : (settlementData ?? [])) {
      const day = dayKey(settlement.settled_at, timeZone)
      const filterable = { fromUser: settlement.from_user, toUser: settlement.to_user, day }
      if (!matchesPaymentFilters(filterable, filters)) continue
      if (search) {
        const haystack = [
          settlement.note ?? '',
          nameOf(settlement.from_user),
          nameOf(settlement.to_user),
        ]
          .join(' ')
          .toLocaleLowerCase()
        if (!haystack.includes(search)) continue
      }
      items.push({ kind: 'settlement', day, at: settlement.settled_at, settlement })
    }
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
    return { sections: groupByDay(items, (item) => item.day), matched }
  }, [expenseData, settlementData, search, filters, nameOf, timeZone])

  const myRole = group.data?.members.find((m) => m.id === me)?.role
  // An archived group is read only: nothing here offers to add to it.
  const archived = !!group.data?.archived_at
  // A 1:1 tab across a block takes no new expenses (payments still go in): say why instead.
  const splitNote = useTabSplitNote(groupId)
  // Payments count too: wait for them before calling the tab empty.
  const loading = expenses.isPending || group.isPending || settlements.isPending
  const empty =
    !loading && (expenses.data?.length ?? 0) === 0 && (settlements.data?.length ?? 0) === 0
  const filtering = query.trim() !== '' || !noFilters(filters) || Boolean(filters.kind)
  const currency = group.data?.currency
  // What the filtered list adds up to, in the group currency: the whole of it and the viewer's
  // part, by the same rules as the balances and Totals.
  const filteredTotals = useMemo(() => {
    if (!filtering || !currency || filters.kind === 'payment') return null
    let total = 0
    let share = 0
    for (const e of matched) {
      const line = viewerShare(
        {
          id: e.id,
          groupId: e.group_id,
          paidBy: e.paid_by,
          payers: payersOf(e).map((p) => ({ userId: p.user_id, paidCents: p.paid_cents })),
          isRefund: e.is_refund,
          amountCents: e.amount_cents,
          currency: e.currency,
          fxRate: e.fx_rate,
          spentAt: e.spent_at,
          category: e.category,
          splits: e.expense_splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
        },
        me,
        currency,
      )
      total += line.totalCents
      share += line.shareCents
    }
    return { count: matched.length, total, share }
  }, [filtering, currency, filters.kind, matched, me])
  const people = useMemo(
    () =>
      (group.data?.members ?? []).map((m) => ({
        id: m.id,
        name: m.id === me ? t('common.you') : m.display_name,
        avatarPath: m.avatar_path,
      })),
    [group.data, me],
  )
  const chips = activeFilters(
    { ...filters, categories: [] },
    { today, personName: (id) => nameOf(id) },
  )
  const toggleCategory = (c: string | null) =>
    setFilters({
      ...filters,
      categories:
        c === null || (filters.categories?.length === 1 && filters.categories[0] === c) ? [] : [c],
    })

  const { exportGroup, busy: exporting } = useGroupExport(groupId)

  if (empty) {
    return (
      <div className="flex flex-col gap-4">
        {/* Repeating expenses can exist before the first one is due. */}
        <RecurringSection groupId={groupId} />
        <HomeStarters groupId={groupId} />
        <EmptyState
          illustration="🧾"
          title={t('empty.expenses.title')}
          description={
            archived && group.data
              ? t('expenses.form.archived', { group: groupTitle(group.data, me) })
              : (splitNote ?? t('empty.expenses.body'))
          }
          action={
            archived || splitNote ? undefined : (
              <Button asChild leadingIcon={<Plus />}>
                <Link to="/new/expense" search={{ groupId }}>
                  {t('empty.expenses.action')}
                </Link>
              </Button>
            )
          }
        />
      </div>
    )
  }

  let rowIndex = 0
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('expenses.search')}
            aria-label={t('expenses.search')}
            leading={<Search />}
            className="h-11 rounded-pill"
            disabled={loading}
          />
        </div>
        <FilterButton filters={filters} onClick={() => setSheetOpen(true)} />
        <IconButton
          label={t('expenses.exportCsv')}
          icon={<Download />}
          variant="secondary"
          onClick={exportGroup}
          disabled={loading || exporting || !expenses.data?.length}
        />
        <ActivityIconLink groupId={groupId} />
        {!archived &&
          (splitNote ? (
            <Button
              leadingIcon={<Plus />}
              className="hidden sm:inline-flex"
              disabled
              aria-describedby="tab-split-note"
            >
              {t('expenses.add')}
            </Button>
          ) : (
            <Button asChild leadingIcon={<Plus />} className="hidden sm:inline-flex">
              <Link to="/new/expense" search={{ groupId }}>
                {t('expenses.add')}
              </Link>
            </Button>
          ))}
      </div>

      {!archived && splitNote && (
        <p id="tab-split-note" className="px-1 text-sm text-pretty text-mute">
          {splitNote}
        </p>
      )}

      {categories.length > 1 && filters.kind !== 'payment' && (
        <div
          role="group"
          aria-label={t('expenses.filterCategory')}
          className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0"
        >
          <Chip selected={selectedCategories.length === 0} onClick={() => toggleCategory(null)}>
            {t('expenses.allCategories')}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c}
              selected={selectedCategories.includes(c)}
              onClick={() => toggleCategory(c)}
              icon={<span className="text-base leading-none">{categoryEmoji(c)}</span>}
            >
              {categoryLabel(c)}
            </Chip>
          ))}
        </div>
      )}

      <ActiveFilterChips
        chips={chips}
        onRemove={(chip) => setFilters(withoutFilter(filters, chip))}
      />

      {filteredTotals && currency && (
        <p
          aria-live="polite"
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-card bg-sunken px-4 py-2.5 text-sm"
        >
          <span className="font-semibold">
            {t('filters.summary', {
              count: filteredTotals.count,
              total: formatMoney(filteredTotals.total, currency),
            })}
          </span>
          <span className="text-mute">
            {t('filters.yourShare', { amount: formatMoney(filteredTotals.share, currency) })}
          </span>
          {filters.kind !== 'expense' &&
            selectedCategories.length > 0 &&
            (settlements.data?.length ?? 0) > 0 && (
              <span className="w-full text-xs text-mute">{t('filters.paymentsHidden')}</span>
            )}
        </p>
      )}

      {!filtering && <RecurringSection groupId={groupId} />}

      {loading ? (
        <ExpenseListSkeleton />
      ) : sections.length === 0 && filtering ? (
        <EmptyState
          illustration="🔍"
          title={t('empty.search.title')}
          description={t('empty.search.body')}
          action={
            <Button
              variant="secondary"
              leadingIcon={<X />}
              onClick={() => {
                setQuery('')
                setFilters({})
              }}
            >
              {t('empty.search.action')}
            </Button>
          }
        />
      ) : (
        <div aria-label={t('expenses.listLabel')} className="flex flex-col gap-5">
          {sections.map((section) => (
            <section key={section.day} aria-labelledby={`day-${section.day}`}>
              <h3
                id={`day-${section.day}`}
                className="mb-2 px-1 text-sm font-bold tracking-tight text-mute"
              >
                {dayLabel(section.day, timeZone)}
              </h3>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {section.items.map((item) => {
                    const index = rowIndex++
                    return (
                      <motion.li
                        key={item.kind === 'expense' ? item.expense.id : item.settlement.id}
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.25 }}
                      >
                        {item.kind === 'expense' ? (
                          <ExpenseRow
                            expense={item.expense}
                            viewerId={me}
                            groupCurrency={group.data?.currency ?? item.expense.currency}
                            nameOf={nameOf}
                          />
                        ) : (
                          <SettlementRow
                            settlement={item.settlement}
                            viewerId={me}
                            nameOf={(id) => nameOf(id)}
                            actions={
                              <SettlementActions
                                settlement={item.settlement}
                                viewerId={me}
                                viewerRole={myRole}
                                label={settlementText(item.settlement, me, nameOf)}
                              />
                            }
                          />
                        )}
                      </motion.li>
                    )
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onChange={setFilters}
        today={today}
        people={people}
        categories={categories.length ? categories : undefined}
        showKind
      />
    </div>
  )
}

export function ExpenseListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={t('expenses.loading')} className="flex flex-col gap-2">
      <Skeleton shape="line" className="mb-1 ml-1 w-20" />
      <Card padding="none" className="divide-y divide-line overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-11 rounded-[0.875rem]" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton shape="line" className="w-2/5" />
              <Skeleton shape="line" className="h-3 w-1/4" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton shape="line" className="h-2.5 w-12" />
              <Skeleton shape="line" className="w-16" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
