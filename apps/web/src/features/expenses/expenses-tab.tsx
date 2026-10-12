import type { ExpenseWithSplits, Settlement } from '@potluck/api'
import { t } from '@potluck/i18n'
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  toast,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Download, Plus, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useUserId } from '@/lib/auth'
import { RecurringSection } from '@/features/recurring/recurring-section'
import { expensesToCsv } from './expense-math'
import { ExpenseRow, SettlementRow } from './expense-row'
import { categoryEmoji, categoryLabel, dayLabel, dayOf, groupByDay } from './format'
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

export function ExpensesTab({ groupId }: { groupId: string }) {
  useGroupMoneyRealtime(groupId)
  const me = useUserId()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const reduced = usePrefersReducedMotion()
  const group = useMoneyGroup(groupId)
  const expenses = useGroupExpenses(groupId)
  const settlements = useGroupSettlements(groupId)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const search = useDeferredValue(query.trim().toLocaleLowerCase())

  const categories = useMemo(() => {
    const seen = new Set<string>()
    for (const e of expenses.data ?? []) seen.add(e.category ?? 'other')
    return [...seen].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
  }, [expenses.data])

  const sections = useMemo(() => {
    const filtering = search !== '' || category !== null
    const items: FeedItem[] = []
    for (const expense of expenses.data ?? []) {
      if (category && (expense.category ?? 'other') !== category) continue
      if (search) {
        const haystack = [
          expense.description,
          expense.notes ?? '',
          categoryLabel(expense.category),
          nameOf(expense.paid_by),
        ]
          .join(' ')
          .toLocaleLowerCase()
        if (!haystack.includes(search)) continue
      }
      items.push({ kind: 'expense', day: expense.spent_at, at: expense.created_at, expense })
    }
    if (!filtering) {
      for (const settlement of settlements.data ?? []) {
        items.push({
          kind: 'settlement',
          day: dayOf(settlement.settled_at, timeZone),
          at: settlement.settled_at,
          settlement,
        })
      }
    }
    items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))
    return groupByDay(items, (item) => item.day)
  }, [expenses.data, settlements.data, search, category, nameOf, timeZone])

  const loading = expenses.isPending || group.isPending
  const empty =
    !loading && (expenses.data?.length ?? 0) === 0 && (settlements.data?.length ?? 0) === 0
  const filtering = query.trim() !== '' || category !== null

  const exportCsv = () => {
    if (!group.data || !expenses.data) return
    const csv = expensesToCsv(expenses.data, group.data.members, group.data.currency)
    const slug = group.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const file = `${slug || 'expenses'}-${new Date().toISOString().slice(0, 10)}.csv`
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = file
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(t('expenses.exported', { file }))
  }

  if (empty) {
    return (
      <EmptyState
        illustration="🧾"
        title={t('empty.expenses.title')}
        description={t('empty.expenses.body')}
        action={
          <Button asChild leadingIcon={<Plus />}>
            <Link to="/new/expense" search={{ groupId }}>
              {t('empty.expenses.action')}
            </Link>
          </Button>
        }
      />
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
        <IconButton
          label={t('expenses.exportCsv')}
          icon={<Download />}
          variant="secondary"
          onClick={exportCsv}
          disabled={loading || !expenses.data?.length}
        />
        <Button asChild leadingIcon={<Plus />} className="hidden sm:inline-flex">
          <Link to="/new/expense" search={{ groupId }}>
            {t('expenses.add')}
          </Link>
        </Button>
      </div>

      {categories.length > 1 && (
        <div
          role="group"
          aria-label={t('expenses.filterCategory')}
          className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1"
        >
          <Chip selected={category === null} onClick={() => setCategory(null)}>
            {t('expenses.allCategories')}
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c}
              selected={category === c}
              onClick={() => setCategory(category === c ? null : c)}
              icon={<span className="text-base leading-none">{categoryEmoji(c)}</span>}
            >
              {categoryLabel(c)}
            </Chip>
          ))}
        </div>
      )}

      <RecurringSection groupId={groupId} />

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
                setCategory(null)
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
                            payerName={nameOf(item.expense.paid_by)}
                          />
                        ) : (
                          <SettlementRow
                            settlement={item.settlement}
                            viewerId={me}
                            nameOf={(id) => nameOf(id)}
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
