import { moneyQueries, restoreExpense } from '@potluck/api'
import { can, convert } from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  buttonClassName,
  cn,
  toast,
} from '@potluck/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRightLeft, ChevronLeft, FileText, PencilLine, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ExpenseComments } from './comments'
import { ExpenseHistory, ItemsCard, PayersLine, SplitCard } from './expense-detail-parts'
import { CategoryTile } from './expense-row'
import { categoryLabel, groupTitle } from './format'
import { Money } from './money'
import {
  invalidateMoney,
  moneyErrorMessage,
  useGroupMoneyRealtime,
  useMoneyGroup,
  useNameOf,
  usePeople,
  useTimeZone,
} from './money-data'
import { departedMembers } from './expense-math'
import { useDeleteExpense } from './use-delete-expense'
import { RepeatCard } from '@/features/recurring/repeat-card'
import { canManageTemplate, openMemberIds } from '@/features/recurring/template'

export function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const me = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const people = usePeople()
  const deleteExpense = useDeleteExpense()
  const [confirming, setConfirming] = useState(false)
  const expense = useQuery(moneyQueries.expense(supabase, expenseId))
  const groupId = expense.data?.group_id
  const group = useMoneyGroup(groupId ?? '')
  useGroupMoneyRealtime(groupId)
  const receipt = useQuery({
    ...moneyQueries.receiptUrl(supabase, expense.data?.receipt_path ?? ''),
    enabled: !!expense.data?.receipt_path,
  })

  if (expense.isError) {
    return (
      <Page>
        <EmptyState
          illustration="🧾"
          title={t('errors.notFound')}
          description={t('expenses.detail.notFound')}
          action={
            <Button asChild variant="secondary">
              <Link to="/groups">{t('nav.groups')}</Link>
            </Button>
          }
        />
      </Page>
    )
  }

  if (!expense.data) return <DetailSkeleton />

  const e = expense.data
  const role = group.data?.members.find((m) => m.id === me)?.role
  const isOwn =
    e.created_by === me || e.paid_by === me || e.expense_payers.some((p) => p.user_id === me)
  // An archived group is read only: no edit, delete, restore or new comments.
  const archived = !!group.data?.archived_at
  const mayEdit = !archived && can(role, 'expense.edit', { isOwn })
  const mayDelete = !archived && can(role, 'expense.delete', { isOwn })
  const deleted = !!e.deleted_at
  // The server will not delete an expense that still moves money for someone who left.
  const departed = group.data
    ? departedMembers(
        e,
        group.data.members.map((m) => m.id),
      ).length > 0
    : false
  // A repeating expense may not name a closed account either (make_expense_recurring).
  const repeatBlocked = group.data
    ? departedMembers(e, openMemberIds(group.data.members)).length > 0
    : false
  const groupCurrency = group.data?.currency ?? e.currency
  const foreign = e.currency !== groupCurrency
  const isPdf = e.receipt_path?.toLowerCase().endsWith('.pdf')

  const onDelete = async () => {
    const ok = await deleteExpense(e)
    if (ok) void navigate({ to: '/groups/$groupId', params: { groupId: e.group_id } })
  }

  const onRestore = async () => {
    try {
      await restoreExpense(supabase, e.id)
      toast.success(t('expenses.restored'))
      invalidateMoney(queryClient, e.group_id, e.id)
    } catch (error) {
      toast.error(moneyErrorMessage(error))
    }
  }

  return (
    <Page>
      <div className="-mx-2 flex items-center justify-between">
        <Link
          to="/groups/$groupId"
          params={{ groupId: e.group_id }}
          className={buttonClassName({ variant: 'ghost', size: 'sm', className: 'pl-2' })}
        >
          <ChevronLeft aria-hidden className="size-5" />
          <span className="max-w-[12rem] truncate">{group.data?.name ?? t('common.back')}</span>
        </Link>
        {!deleted && (mayEdit || mayDelete) && (
          <div className="flex gap-1" role="group" aria-label={t('expenses.detail.actions')}>
            {mayEdit && (
              <Link
                to="/expenses/$expenseId/edit"
                params={{ expenseId: e.id }}
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                <PencilLine aria-hidden className="size-4" />
                {t('common.edit')}
              </Link>
            )}
            {mayDelete && !departed && (
              <IconButton
                size="sm"
                variant="ghost"
                label={t('common.delete')}
                icon={<Trash2 />}
                onClick={() => setConfirming(true)}
              />
            )}
          </div>
        )}
      </div>

      {archived && group.data && (
        <p
          role="note"
          className="mt-4 rounded-card bg-sunken px-4 py-3 text-sm font-medium text-mute"
        >
          {t('expenses.form.archived', { group: groupTitle(group.data, me) })}
        </p>
      )}

      {!deleted && departed && (mayEdit || mayDelete) && (
        <p role="note" className="mt-4 text-sm font-medium text-saffron-ink">
          {t('expenses.detail.departedLocked')}
        </p>
      )}

      {deleted && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-card bg-tomato-soft px-4 py-3 text-tomato-ink"
        >
          <span className="text-sm font-semibold">{t('expenses.detail.deletedBanner')}</span>
          {mayEdit && (
            <Button size="sm" variant="secondary" onClick={onRestore}>
              {t('expenses.restore')}
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <header className={cn('flex flex-col gap-4', deleted && 'opacity-60')}>
            <div className="flex items-start gap-4">
              <CategoryTile category={e.category} size="xl" className="rotate-[-4deg]" />
              <div className="min-w-0 pt-1">
                <p className="text-sm font-semibold text-mute">
                  {e.is_refund && (
                    <span className="mr-2 inline-flex items-center rounded-pill bg-olive-soft px-2 py-0.5 text-xs font-bold text-olive-ink">
                      {t('expenses.refund.badge')}
                    </span>
                  )}
                  {categoryLabel(e.category)}
                  {e.recurring_id && (
                    <Repeat aria-hidden className="ml-1.5 inline size-3.5" strokeWidth={2.5} />
                  )}
                </p>
                <h1 className="font-display text-[2.5rem] leading-[1] text-balance break-words">
                  {e.description}
                </h1>
              </div>
            </div>
            <p className="text-[3.5rem] leading-none font-extrabold tracking-tight sm:text-[4.5rem]">
              <Money cents={e.amount_cents} currency={e.currency} tone="neutral" split />
            </p>
            {foreign && (
              <p className="inline-flex items-center gap-1.5 text-sm text-mute">
                <ArrowRightLeft aria-hidden className="size-4" />
                {t('expenses.detail.converted', {
                  amount: formatMoney(
                    convert(e.amount_cents, e.fx_rate, { from: e.currency, to: groupCurrency }),
                    groupCurrency,
                  ),
                  currency: groupCurrency,
                  rate: String(Number(e.fx_rate)),
                })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9375rem]">
              <PayersLine expense={e} me={me} people={people} nameOf={nameOf} />
              <time dateTime={e.spent_at} className="text-mute">
                {formatDate(e.spent_at, { timeZone, style: 'full' })}
              </time>
            </div>
          </header>

          {!deleted && group.data && (
            <RepeatCard
              expense={e}
              timeZone={timeZone}
              canManage={(template) => canManageTemplate(template, role, me, archived)}
              canMakeRepeat={mayEdit && !e.is_refund && !repeatBlocked}
            />
          )}
          <SplitCard expense={e} me={me} people={people} nameOf={nameOf} />
          <ExpenseHistory expense={e} me={me} timeZone={timeZone} nameOf={nameOf} />
        </div>

        <div className="flex flex-col gap-8">
          <ItemsCard expense={e} me={me} nameOf={nameOf} />
          {e.receipt_path && (
            <section aria-labelledby="receipt-title" className="flex flex-col gap-3">
              <h2 id="receipt-title" className="font-display text-2xl">
                {t('expenses.detail.receipt')}
              </h2>
              {receipt.data ? (
                isPdf ? (
                  <a
                    href={receipt.data}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-card border border-line bg-card p-4 font-semibold hover:border-line-strong"
                  >
                    <FileText aria-hidden className="size-6 text-mute" />
                    {t('expenses.receiptUpload.pdf')}
                  </a>
                ) : (
                  <a
                    href={receipt.data}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('expenses.receiptUpload.open')}
                    className="block overflow-hidden rounded-card border border-line bg-sunken"
                  >
                    <img
                      src={receipt.data}
                      alt={t('expenses.receiptUpload.alt', { description: e.description })}
                      className="max-h-[28rem] w-full object-contain"
                    />
                  </a>
                )
              ) : (
                <Skeleton className="h-56" />
              )}
            </section>
          )}
          {e.notes && (
            <section aria-labelledby="notes-title" className="flex flex-col gap-2">
              <h2 id="notes-title" className="font-display text-2xl">
                {t('expenses.detail.notes')}
              </h2>
              <p className="rounded-card bg-sunken px-4 py-3 text-[0.9375rem] whitespace-pre-wrap">
                {e.notes}
              </p>
            </section>
          )}
          <ExpenseComments
            expenseId={e.id}
            canModerate={role === 'owner' || role === 'admin'}
            readOnly={archived}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('common.delete')}
        description={t('expenses.deleteConfirm', { description: e.description })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={onDelete}
      />
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-3 pb-32 lg:px-8 lg:pt-8 lg:pb-12">
      {children}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <Page>
      <div
        aria-busy="true"
        aria-label={t('expenses.detail.loading')}
        className="flex flex-col gap-6 pt-14"
      >
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-[1.5rem]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton shape="line" className="w-20" />
            <Skeleton className="h-9 w-3/5" />
          </div>
        </div>
        <Skeleton className="h-16 w-48" />
        <Skeleton className="h-56 lg:w-1/2" />
      </div>
    </Page>
  )
}
