import { avatarSrc } from '@/lib/queries'
import { paymentKeys, paymentQueries } from '@potluck/api'
import { can, convert } from '@potluck/core'
import { formatDate, formatMoney, formatRelative, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  buttonClassName,
  cn,
} from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, ArrowRightLeft, ChevronLeft, PencilLine, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useUserId } from '@/lib/auth'
import { useBatchedInvalidate, useRealtime } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { CommentThread } from '@/features/expenses/comments'
import { Money } from '@/features/expenses/money'
import {
  useGroupMoneyRealtime,
  useMoneyGroup,
  useNameOf,
  usePeople,
  useTimeZone,
} from '@/features/expenses/money-data'
import { useDeletePayment, useRestorePayment } from './use-delete-payment'

/** One payment: who paid whom, when, the note, and its comments. Deleted ones can be restored. */
export function PaymentDetail({ paymentId }: { paymentId: string }) {
  const me = useUserId()
  const navigate = useNavigate()
  const timeZone = useTimeZone()
  const nameOf = useNameOf()
  const people = usePeople()
  const deletePayment = useDeletePayment()
  const restorePayment = useRestorePayment()
  const [confirming, setConfirming] = useState(false)
  const payment = useQuery(paymentQueries.settlement(supabase, paymentId))
  const groupId = payment.data?.group_id
  const group = useMoneyGroup(groupId)
  useGroupMoneyRealtime(groupId)
  usePaymentRealtime(paymentId, groupId)

  if (payment.isError) {
    return (
      <Page>
        <EmptyState
          illustration="🤝"
          title={t('errors.notFound')}
          description={t('settle.detail.notFound')}
          action={
            <Button asChild variant="secondary">
              <Link to="/groups">{t('nav.groups')}</Link>
            </Button>
          }
        />
      </Page>
    )
  }

  if (!payment.data) return <DetailSkeleton />

  const p = payment.data
  const role = group.data?.members.find((m) => m.id === me)?.role
  const isParty = [p.from_user, p.to_user, p.created_by].includes(me)
  const mayEdit = can(role, 'settlement.edit', { isParty })
  const mayDelete = can(role, 'settlement.delete', { isParty })
  const mayRestore = can(role, 'settlement.restore', { isParty })
  const deleted = !!p.deleted_at
  const archived = !!group.data?.archived_at
  const memberIds = group.data?.members.map((m) => m.id) ?? []
  // The server will not move a former member's balance: no delete or restore, details only.
  const departed =
    !!group.data && (!memberIds.includes(p.from_user) || !memberIds.includes(p.to_user))
  const groupCurrency = group.data?.currency ?? p.currency
  const foreign = p.currency !== groupCurrency
  const from = people.get(p.from_user)
  const to = people.get(p.to_user)

  const onDelete = async () => {
    const ok = await deletePayment(p)
    if (ok) void navigate({ to: '/groups/$groupId', params: { groupId: p.group_id } })
  }

  return (
    <Page>
      <div className="-mx-2 flex items-center justify-between">
        <Link
          to="/groups/$groupId"
          params={{ groupId: p.group_id }}
          className={buttonClassName({ variant: 'ghost', size: 'sm', className: 'pl-2' })}
        >
          <ChevronLeft aria-hidden className="size-5" />
          <span className="max-w-[12rem] truncate">{group.data?.name ?? t('common.back')}</span>
        </Link>
        {!deleted && !archived && (mayEdit || mayDelete) && (
          <div className="flex gap-1" role="group" aria-label={t('settle.detail.actions')}>
            {mayEdit && (
              <Link
                to="/payments/$paymentId/edit"
                params={{ paymentId: p.id }}
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
                label={t('settle.delete')}
                icon={<Trash2 />}
                onClick={() => setConfirming(true)}
              />
            )}
          </div>
        )}
      </div>

      {!deleted && departed && mayEdit && (
        <p role="note" className="mt-4 text-sm font-medium text-saffron-ink">
          {t('settle.detail.departedLocked')}
        </p>
      )}

      {deleted && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-card bg-tomato-soft px-4 py-3 text-tomato-ink"
        >
          <span className="text-sm font-semibold">{t('settle.detail.deletedBanner')}</span>
          {mayRestore && !departed && !archived && (
            <Button size="sm" variant="secondary" onClick={() => void restorePayment(p)}>
              {t('settle.restore')}
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-6">
          <header className={cn('flex flex-col gap-4', deleted && 'opacity-60')}>
            <div className="flex items-start gap-4">
              <span
                aria-hidden
                className="grid size-20 shrink-0 rotate-[-4deg] place-items-center rounded-[1.5rem] bg-olive-soft text-olive-ink"
              >
                <ArrowRightLeft className="size-9" />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-sm font-semibold text-mute">{t('settle.detail.title')}</p>
                <h1 className="font-display text-[2.5rem] leading-[1] text-balance break-words">
                  {t('settle.between', {
                    from: nameOf(p.from_user),
                    to: nameOf(p.to_user, { lower: true }),
                  })}
                </h1>
              </div>
            </div>
            <p className="text-[3.5rem] leading-none font-extrabold tracking-tight sm:text-[4.5rem]">
              <Money cents={p.amount_cents} currency={p.currency} tone="settled" split />
            </p>
            {foreign && (
              <p className="inline-flex items-center gap-1.5 text-sm text-mute">
                <ArrowRightLeft aria-hidden className="size-4" />
                {t('settle.detail.converted', {
                  amount: formatMoney(
                    convert(p.amount_cents, p.fx_rate, { from: p.currency, to: groupCurrency }),
                    groupCurrency,
                  ),
                  currency: groupCurrency,
                  rate: String(Number(p.fx_rate)),
                })}
              </p>
            )}
            <time dateTime={p.settled_at} className="text-[0.9375rem] text-mute">
              {formatDate(p.settled_at, { timeZone, style: 'full' })}
            </time>
          </header>

          <div
            aria-hidden
            className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-4"
          >
            <PersonChip
              name={from?.display_name ?? nameOf(p.from_user)}
              seed={p.from_user}
              src={avatarSrc(from?.avatar_path)}
              label={nameOf(p.from_user)}
            />
            <ArrowRight className="size-5 shrink-0 text-olive-ink" strokeWidth={2.5} />
            <PersonChip
              name={to?.display_name ?? nameOf(p.to_user)}
              seed={p.to_user}
              src={avatarSrc(to?.avatar_path)}
              label={nameOf(p.to_user)}
            />
          </div>

          {p.note && (
            <section aria-labelledby="note-title" className="flex flex-col gap-2">
              <h2 id="note-title" className="font-display text-2xl">
                {t('settle.detail.note')}
              </h2>
              <p className="rounded-card bg-sunken px-4 py-3 text-[0.9375rem] whitespace-pre-wrap">
                {p.note}
              </p>
            </section>
          )}
          {p.created_by && (
            <p className="text-sm text-mute">
              {t('settle.detail.recordedBy', {
                name: nameOf(p.created_by),
                when: formatRelative(p.created_at, { timeZone }),
              })}
            </p>
          )}
        </div>

        <CommentThread
          subject={{ settlementId: p.id }}
          canModerate={role === 'owner' || role === 'admin'}
        />
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('settle.delete')}
        description={t('settle.deleteConfirm')}
        confirmLabel={t('settle.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={onDelete}
      />
    </Page>
  )
}

function PersonChip({
  name,
  seed,
  src,
  label,
}: {
  name: string
  seed: string
  src: ReturnType<typeof avatarSrc>
  label: string
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Avatar name={name} seed={seed} src={src} size="md" />
      <span className="truncate font-semibold">{label}</span>
    </span>
  )
}

/** Keeps the payment and its comments fresh while it is open. */
function usePaymentRealtime(paymentId: string, groupId: string | undefined) {
  const bump = useBatchedInvalidate()
  useRealtime(
    groupId ? `payment:${paymentId}` : null,
    [
      { table: 'settlements', filter: `id=eq.${paymentId}` },
      { table: 'activity', event: 'INSERT', filter: `group_id=eq.${groupId}` },
    ],
    (payload) => {
      if (payload.table === 'settlements') {
        bump(paymentKeys.settlement(paymentId))
        return
      }
      const row = payload.new as { verb?: string; data?: { settlement_id?: string } }
      if (row.verb === 'comment.created' && row.data?.settlement_id === paymentId) {
        bump(paymentKeys.comments(paymentId))
      }
    },
  )
}

function Page({ children }: { children: ReactNode }) {
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
        aria-label={t('settle.detail.loading')}
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
        <Skeleton className="h-20 lg:w-1/2" />
      </div>
    </Page>
  )
}
