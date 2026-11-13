import { searchInfiniteQueryOptions, type SearchFilters, type SearchHit } from '@potluck/api'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Button, Card, cn, EmptyState, Input, Skeleton, usePrefersReducedMotion } from '@potluck/ui'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRightLeft, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { namesOf } from '@/features/expenses/expense-math'
import { CategoryTile } from '@/features/expenses/expense-row'
import { groupTitle, todayIn } from '@/features/expenses/format'
import { Money } from '@/features/expenses/money'
import { useNameOf, usePeople, useTimeZone } from '@/features/expenses/money-data'
import { GroupTile } from '@/features/groups/group-bits'
import { useMyGroups } from '@/features/groups/use-groups'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ActiveFilterChips, FilterButton, FilterSheet } from './filter-sheet'
import { activeFilters, countFilters, withoutFilter, type MoneyFilters } from './filter-state'
import { LoadProblem } from './load-problem'
import { hasLoadProblem } from './load-state'
import type { MoneySearch } from './search-params'
import { snippetParts } from './snippet'

const DEBOUNCE_MS = 250

/** "Nov 7" this year, "Oct 15, 2025" before. */
function shortDay(day: string): string {
  const thisYear = String(new Date().getUTCFullYear())
  return formatDate(day, {
    timeZone: 'UTC',
    style: day.startsWith(thisYear) ? 'dayMonth' : 'medium',
  })
}

function toFilters(search: MoneySearch): MoneyFilters {
  return {
    from: search.from ?? null,
    to: search.to ?? null,
    person: search.person ?? null,
    categories: search.cats ? search.cats.split(',') : [],
    groupId: search.groupId ?? null,
    kind: search.kind ?? null,
  }
}

function toSearch(q: string, f: MoneyFilters): MoneySearch {
  return {
    q: q.trim() || undefined,
    groupId: f.groupId || undefined,
    person: f.person || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    cats: f.categories?.length ? f.categories.join(',') : undefined,
    kind: f.kind || undefined,
  }
}

/**
 * "Ava paid $90.00", "You and Ben paid $90.00", or for a refund "Ava got back $40.00": the same
 * wording as the expense rows, from every payer.
 */
function paidLine(
  hit: SearchHit,
  viewerId: string,
  nameOf: (id: string, opts?: { lower?: boolean }) => string,
  amount: string,
): string {
  const ids = hit.payers.length > 0 ? hit.payers : [hit.paidBy]
  if (ids.length > 1) {
    const names = namesOf(ids, viewerId, nameOf)
    return hit.isRefund
      ? t('expenses.refund.gotBackMany', { names, amount })
      : t('expenses.payers.paidMany', { names, amount })
  }
  const only = ids[0]!
  if (only === viewerId) {
    return hit.isRefund
      ? t('expenses.refund.youGotBack', { amount })
      : t('expenses.youPaid', { amount })
  }
  return hit.isRefund
    ? t('expenses.refund.gotBack', { name: nameOf(only), amount })
    : t('expenses.paidSummary', { name: nameOf(only), amount })
}

/** Why a hit matched, when it was not the title. */
/** The comment around the words that matched, with those words marked. */
function CommentMatch({ text, query }: { text: string; query: string }) {
  const { before, match, after } = snippetParts(text, query)
  // The sentence ("Comment: "{text}"") stays in the dictionary; the snippet goes in its slot.
  const [lead = '', tail = ''] = t('search.matched.comment', { text: '\u0000' }).split('\u0000')
  return (
    <>
      {lead}
      {before}
      {match && (
        <mark className="rounded-[0.25rem] bg-saffron-soft px-0.5 font-semibold text-ink not-italic">
          {match}
        </mark>
      )}
      {after}
      {tail}
    </>
  )
}

function matchLine(hit: SearchHit, query: string): ReactNode {
  switch (hit.matched) {
    case 'comment':
      return <CommentMatch text={hit.snippet ?? ''} query={query} />
    case 'notes':
      return hit.kind === 'expense' ? t('search.matched.notes') : null
    case 'person':
      return hit.snippet ? t('search.matched.person', { name: hit.snippet }) : null
    case 'amount':
      return t('search.matched.amount')
    default:
      return null
  }
}

function HitRow({
  hit,
  viewerId,
  nameOf,
  query,
}: {
  hit: SearchHit
  viewerId: string
  nameOf: (id: string | null, opts?: { lower?: boolean }) => string
  query: string
}) {
  const date = shortDay(hit.day)
  const amount = formatMoney(hit.amountCents, hit.currency)
  const why = matchLine(hit, query)

  if (hit.kind === 'payment') {
    return (
      <Link
        to="/payments/$paymentId"
        params={{ paymentId: hit.id }}
        className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3 outline-offset-[-2px] transition-colors hover:bg-sunken/70"
      >
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[0.875rem] bg-olive-soft text-olive-ink"
        >
          <ArrowRightLeft className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.9375rem] font-semibold">
            {t('search.paymentRow', {
              from: nameOf(hit.paidBy),
              to: nameOf(hit.toUser, { lower: true }),
            })}
          </span>
          <span className="truncate text-sm text-mute">
            {hit.description
              ? `${hit.description}, ${date}`
              : `${t('search.paymentNote')}, ${date}`}
          </span>
          {why && <span className="line-clamp-2 text-sm text-ink/80 italic">{why}</span>}
        </span>
        <Money
          cents={hit.amountCents}
          currency={hit.currency}
          tone="settled"
          className="text-[0.9375rem] font-bold"
        />
      </Link>
    )
  }

  const paid = hit.myPaidCents ?? 0
  const share = hit.myShareCents ?? 0
  const net = paid - share
  return (
    <Link
      to="/expenses/$expenseId"
      params={{ expenseId: hit.id }}
      className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3 outline-offset-[-2px] transition-colors hover:bg-sunken/70"
    >
      <CategoryTile category={hit.category} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] font-semibold">{hit.description}</span>
        <span className="truncate text-sm text-mute">
          {t('search.withDate', { line: paidLine(hit, viewerId, nameOf, amount), date })}
        </span>
        {why && <span className="line-clamp-2 text-sm text-ink/80 italic">{why}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {net === 0 ? (
          <span className="text-xs text-mute">{t('expenses.notInvolved')}</span>
        ) : (
          <>
            <span
              aria-hidden
              className={cn(
                'text-xs font-medium',
                net > 0 ? 'text-saffron-ink' : 'text-tomato-ink',
              )}
            >
              {net > 0 ? t('expenses.youLentLabel') : t('expenses.youBorrowedLabel')}
            </span>
            <Money
              cents={Math.abs(net)}
              currency={hit.groupCurrency}
              tone={net > 0 ? 'owed' : 'owe'}
              className="text-[0.9375rem] font-bold"
              srLabel={
                net > 0
                  ? t('expenses.youLent', { amount: formatMoney(net, hit.groupCurrency) })
                  : t('expenses.youBorrowed', { amount: formatMoney(-net, hit.groupCurrency) })
              }
            />
          </>
        )}
      </span>
    </Link>
  )
}

/** Search every group: expenses and payments, by text and filters, grouped by group. */
export function SearchScreen({ search }: { search: MoneySearch }) {
  const navigate = useNavigate()
  const me = useUserId()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const people = usePeople()
  const groups = useMyGroups()
  const reduced = usePrefersReducedMotion()
  const today = todayIn(timeZone)
  const [text, setText] = useState(search.q ?? '')
  const [seenQ, setSeenQ] = useState(search.q)
  const [wroteQ, setWroteQ] = useState(search.q)
  if (search.q !== seenQ) {
    setSeenQ(search.q)
    if (search.q !== wroteQ) {
      setWroteQ(search.q)
      setText(search.q ?? '')
    }
  }
  const [sheetOpen, setSheetOpen] = useState(false)
  const filters = useMemo(() => toFilters(search), [search])

  // Typing updates the address (replace, so Back leaves search) once it settles.
  useEffect(() => {
    if (text.trim() === (search.q ?? '').trim()) return
    const timer = setTimeout(() => {
      const next = toSearch(text, filters)
      setWroteQ(next.q)
      void navigate({ to: '/search', search: next, replace: true })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, search.q, filters, navigate])

  const setFilters = (next: MoneyFilters) => {
    const address = toSearch(text, next)
    setWroteQ(address.q)
    void navigate({ to: '/search', search: address, replace: true })
  }

  const query: SearchFilters = {
    query: search.q,
    groupId: search.groupId,
    person: search.person,
    from: search.from,
    to: search.to,
    categories: filters.categories ?? undefined,
    kinds: search.kind ? [search.kind] : undefined,
  }
  const active = Boolean(search.q) || countFilters(filters) > 0
  const results = useInfiniteQuery({
    ...searchInfiniteQueryOptions(supabase, query),
    enabled: active,
    placeholderData: keepPreviousData,
  })

  const groupById = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g])), [groups.data])
  const groupName = (id: string) => {
    const g = groupById.get(id)
    return g ? groupTitle(g, me) : ''
  }
  const hits = useMemo(() => results.data?.pages.flat() ?? [], [results.data])
  const sections = useMemo(() => {
    const byGroup = new Map<string, SearchHit[]>()
    for (const hit of hits) {
      const list = byGroup.get(hit.groupId)
      if (list) list.push(hit)
      else byGroup.set(hit.groupId, [hit])
    }
    return [...byGroup.entries()].map(([groupId, items]) => ({ groupId, items }))
  }, [hits])

  const chips = activeFilters(filters, {
    today,
    personName: (id) => nameOf(id),
    groupName,
  })
  const peopleList = useMemo(
    () =>
      [...people.values()]
        .filter((p) => !p.deleted_at)
        .map((p) => ({
          id: p.id,
          name: p.id === me ? t('common.you') : p.display_name,
          avatarPath: p.avatar_path,
        }))
        .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name))),
    [people, me],
  )
  const groupList = useMemo(
    () =>
      (groups.data ?? []).map((g) => ({
        id: g.id,
        name: groupTitle(g, me),
        emoji: g.is_direct ? '🤝' : g.emoji,
      })),
    [groups.data, me],
  )
  const count = hits.length
  const stale = results.isPlaceholderData

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-32 lg:px-8 lg:pt-10 lg:pb-12">
      <header className="flex items-end justify-between gap-3">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[-0.02em]">
          {t('search.title')}
        </h1>
        <Help topic="search" />
      </header>

      <div className="sticky top-0 z-20 -mx-4 mt-4 flex items-center gap-2 bg-paper/95 px-4 py-2 backdrop-blur-sm lg:mx-0 lg:px-0">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.label')}
            leading={<Search />}
            trailing={
              text ? (
                <button
                  type="button"
                  aria-label={t('empty.search.action')}
                  onClick={() => setText('')}
                  className="grid size-8 place-items-center rounded-full text-mute hover:bg-sunken hover:text-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : undefined
            }
            className="h-12 rounded-pill text-base [&::-webkit-search-cancel-button]:appearance-none"
            autoFocus
            enterKeyHint="search"
          />
        </div>
        <FilterButton filters={filters} onClick={() => setSheetOpen(true)} />
      </div>

      <ActiveFilterChips
        chips={chips}
        className="mt-2"
        onRemove={(chip) => setFilters(withoutFilter(filters, chip))}
      />

      <p aria-live="polite" className="mt-3 min-h-5 px-1 text-sm text-mute">
        {active && !results.isPending
          ? results.hasNextPage
            ? t('search.resultsMore', { count })
            : t('search.results', { count })
          : ''}
      </p>

      <div className="mt-2">
        {!active ? (
          <EmptyState
            illustration="🔎"
            title={t('search.idleTitle')}
            description={t('search.hint')}
          />
        ) : hasLoadProblem(results) ? (
          <LoadProblem query={results} />
        ) : results.isPending ? (
          <div aria-busy="true" aria-label={t('search.loading')} className="flex flex-col gap-2">
            <Skeleton shape="line" className="mb-1 ml-1 w-32" />
            <Skeleton className="h-[4.5rem]" />
            <Skeleton className="h-[4.5rem]" />
            <Skeleton className="h-[4.5rem]" />
          </div>
        ) : count === 0 ? (
          <EmptyState
            illustration="🔍"
            title={t('empty.search.title')}
            description={t('empty.search.body')}
            action={
              <Button
                variant="secondary"
                leadingIcon={<X />}
                onClick={() => {
                  setText('')
                  setWroteQ(undefined)
                  void navigate({ to: '/search', search: {}, replace: true })
                }}
              >
                {t('empty.search.action')}
              </Button>
            }
          />
        ) : (
          <div className={cn('flex flex-col gap-6 transition-opacity', stale && 'opacity-60')}>
            {sections.map((section, s) => {
              const g = groupById.get(section.groupId)
              const name = groupName(section.groupId)
              return (
                <motion.section
                  key={section.groupId}
                  aria-label={t('search.inGroup', { count: section.items.length, group: name })}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(s, 6) * 0.03, duration: 0.25 }}
                >
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: section.groupId }}
                    className="mb-2 flex items-center gap-2.5 rounded-pill px-1 hover:text-ink"
                  >
                    <GroupTile
                      emoji={g?.is_direct ? '🤝' : (g?.emoji ?? null)}
                      color={g?.color ?? null}
                      size="sm"
                      tilt={false}
                      className="size-8 text-base"
                    />
                    <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold tracking-tight">
                      {name}
                    </h2>
                    <span className="text-sm text-mute tabular-nums">{section.items.length}</span>
                  </Link>
                  <Card padding="none" className="overflow-hidden">
                    <ul className="divide-y divide-line">
                      {section.items.map((hit) => (
                        <li key={`${hit.kind}:${hit.id}`}>
                          <HitRow hit={hit} viewerId={me} nameOf={nameOf} query={search.q ?? ''} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </motion.section>
              )
            })}
            {results.hasNextPage && (
              <Button
                variant="secondary"
                className="self-center"
                loading={results.isFetchingNextPage}
                onClick={() => void results.fetchNextPage()}
              >
                {t('search.loadMore')}
              </Button>
            )}
          </div>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onChange={setFilters}
        today={today}
        people={peopleList}
        groups={groupList}
        showKind
      />
    </div>
  )
}
