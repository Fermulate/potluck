import { deletedItemsInfiniteQueryOptions, restoreExpense, type DeletedItem } from '@potluck/api'
import { formatDate, formatMoney, formatRelative, t } from '@potluck/i18n'
import { Button, Card, EmptyState, Skeleton, toast } from '@potluck/ui'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { CategoryTile } from '@/features/expenses/expense-row'
import {
  invalidateMoney,
  moneyErrorMessage,
  useGroupMoneyRealtime,
  useMoneyGroup,
  useNameOf,
  useTimeZone,
} from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { LoadProblem } from './load-problem'
import { hasLoadProblem } from './load-state'
import { useRestorePayment } from '@/features/settle/use-delete-payment'

/**
 * A group's deleted expenses and payments, most recently deleted first, with who deleted them.
 * Restore shows for the people the server lets restore: for an expense whoever added it or paid
 * any of it, and admins (`restore_expense`); for a payment either side or whoever recorded it,
 * and admins (`restore_settlement`).
 */
export function DeletedScreen({ groupId }: { groupId: string }) {
  useGroupMoneyRealtime(groupId)
  const me = useUserId()
  const nameOf = useNameOf()
  const timeZone = useTimeZone()
  const queryClient = useQueryClient()
  const group = useMoneyGroup(groupId)
  const items = useInfiniteQuery(deletedItemsInfiniteQueryOptions(supabase, groupId))
  const [busy, setBusy] = useState<string | null>(null)
  const restorePayment = useRestorePayment()
  const role = group.data?.members.find((m) => m.id === me)?.role
  const archived = Boolean(group.data?.archived_at)
  const rows = items.data?.pages.flat() ?? []

  const canRestore = (hit: DeletedItem) =>
    !archived &&
    (role === 'admin' ||
      role === 'owner' ||
      hit.createdBy === me ||
      hit.payers.includes(me) ||
      (hit.kind === 'payment' && hit.toUser === me))

  const restore = async (hit: DeletedItem, title: string) => {
    setBusy(hit.id)
    try {
      if (hit.kind === 'payment') {
        await restorePayment({ id: hit.id, group_id: hit.groupId })
      } else {
        await restoreExpense(supabase, hit.id)
        toast.success(t('deletedItems.restored', { description: title }))
        invalidateMoney(queryClient, groupId, hit.id)
      }
    } catch (error) {
      toast.error(moneyErrorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Link
            to="/groups/$groupId/totals"
            params={{ groupId }}
            className="-ml-2 inline-flex h-11 items-center gap-1 rounded-pill pr-3 pl-1 text-sm font-semibold text-mute hover:text-ink"
          >
            <ChevronLeft aria-hidden className="size-5" />
            {t('deletedItems.back')}
          </Link>
          <h2 className="font-display text-3xl leading-none">{t('deletedItems.title')}</h2>
          {group.data && (
            <p className="mt-1.5 text-sm text-mute">
              {t('deletedItems.subtitle', { group: group.data.name })}
            </p>
          )}
        </div>
        <Help topic="restore" />
      </div>

      {hasLoadProblem(items) ? (
        <LoadProblem query={items} />
      ) : items.isPending ? (
        <div
          aria-busy="true"
          aria-label={t('deletedItems.loading')}
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-[4.5rem]" />
          <Skeleton className="h-[4.5rem]" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          illustration="🗑️"
          title={t('deletedItems.empty.title')}
          description={t('deletedItems.empty.body')}
        />
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-line">
              {rows.map((hit) => {
                const date = formatDate(hit.day, {
                  timeZone: 'UTC',
                  style: hit.day.startsWith(String(new Date().getUTCFullYear()))
                    ? 'dayMonth'
                    : 'medium',
                })
                const amount = formatMoney(hit.amountCents, hit.currency)
                const title =
                  hit.kind === 'expense'
                    ? (hit.description ?? '')
                    : t('search.paymentRow', {
                        from: nameOf(hit.paidBy),
                        to: nameOf(hit.toUser, { lower: true }),
                      })
                return (
                  <li key={hit.id} className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3">
                    {hit.kind === 'expense' ? (
                      <CategoryTile category={hit.category} className="opacity-70 grayscale" />
                    ) : (
                      <span
                        aria-hidden
                        className="grid size-11 shrink-0 place-items-center rounded-[0.875rem] bg-olive-soft text-olive-ink opacity-70"
                      >
                        <ArrowRightLeft className="size-5" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {hit.kind === 'expense' ? (
                        <Link
                          to="/expenses/$expenseId"
                          params={{ expenseId: hit.id }}
                          className="truncate text-[0.9375rem] font-semibold text-ink line-through decoration-mute/60 hover:underline"
                        >
                          {title}
                        </Link>
                      ) : (
                        <Link
                          to="/payments/$paymentId"
                          params={{ paymentId: hit.id }}
                          className="truncate text-[0.9375rem] font-semibold text-ink line-through decoration-mute/60 hover:underline"
                        >
                          {title}
                        </Link>
                      )}
                      <span className="truncate text-sm text-mute">
                        {amount}, {t('deletedItems.deletedOn', { date })}
                      </span>
                      <span className="truncate text-xs text-mute">
                        {hit.deletedBy
                          ? t('deletedItems.deletedBy', {
                              name: nameOf(hit.deletedBy, { lower: true }),
                              when: formatRelative(hit.deletedAt, { timeZone }),
                            })
                          : t('deletedItems.deletedWhen', {
                              when: formatRelative(hit.deletedAt, { timeZone }),
                            })}
                      </span>
                    </span>
                    {canRestore(hit) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === hit.id}
                        aria-label={t('deletedItems.restoreLabel', { description: title })}
                        onClick={() => void restore(hit, title)}
                      >
                        {t('deletedItems.restore')}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
          {items.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={items.isFetchingNextPage}
              onClick={() => void items.fetchNextPage()}
            >
              {t('search.loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
