import {
  deleteRecurring,
  moneyKeys,
  moneyQueries,
  setRecurringActive,
  type RecurringExpense,
} from '@potluck/api'
import { can } from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Badge, Card, ConfirmDialog, IconButton, toast, cn } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Pause, Play, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { categoryEmoji } from '@/features/expenses/format'
import { moneyErrorMessage, useMoneyGroup, useNameOf } from '@/features/expenses/money-data'

/**
 * Repeating expenses for a group, folded away under the search bar. The creator or an admin
 * can pause, resume, or stop each one.
 */
export function RecurringSection({ groupId }: { groupId: string }) {
  const { data } = useQuery(moneyQueries.recurring(supabase, groupId))
  const [open, setOpen] = useState(false)
  if (!data || data.length === 0) return null
  const active = data.filter((r) => r.active).length

  return (
    <Card padding="none" tone="sunken" className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`recurring-${groupId}`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-full bg-plum-soft text-plum-ink"
        >
          <Repeat className="size-4" strokeWidth={2.5} />
        </span>
        <span className="flex-1 text-[0.9375rem] font-semibold">
          {t('expenses.recurring.title')}
        </span>
        <span className="tabular text-sm text-mute">
          {active}/{data.length}
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 text-mute transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={`recurring-${groupId}`} className="border-t border-line bg-card">
          <p className="px-4 pt-3 text-sm text-mute">{t('expenses.recurring.hint')}</p>
          <ul className="divide-y divide-line">
            {data.map((r) => (
              <RecurringRow key={r.id} item={r} groupId={groupId} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function RecurringRow({ item, groupId }: { item: RecurringExpense; groupId: string }) {
  const me = useUserId()
  const nameOf = useNameOf()
  const queryClient = useQueryClient()
  const group = useMoneyGroup(groupId)
  const [confirm, setConfirm] = useState(false)
  const role = group.data?.members.find((m) => m.id === me)?.role
  const allowed = can(role, 'expense.edit', { isOwn: item.created_by === me })
  const key = moneyKeys.recurring(groupId)

  const toggle = useMutation({
    mutationFn: (active: boolean) => setRecurringActive(supabase, item.id, active),
    onMutate: async (active) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<RecurringExpense[]>(key)
      queryClient.setQueryData<RecurringExpense[]>(key, (rows) =>
        rows?.map((r) => (r.id === item.id ? { ...r, active } : r)),
      )
      return { previous }
    },
    onError: (error, _active, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
      toast.error(moneyErrorMessage(error))
    },
    onSuccess: (_data, active) => {
      toast.success(
        t(active ? 'expenses.recurring.resumedToast' : 'expenses.recurring.pausedToast', {
          description: item.description,
        }),
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = async () => {
    try {
      await deleteRecurring(supabase, item.id)
      toast.success(t('expenses.recurring.removedToast', { description: item.description }))
    } catch (error) {
      toast.error(moneyErrorMessage(error))
    }
    await queryClient.invalidateQueries({ queryKey: key })
  }

  const amount = formatMoney(item.amount_cents, item.currency)
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className="text-2xl leading-none">
        {categoryEmoji(item.category)}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-semibold', !item.active && 'text-mute')}>
          {item.description}
        </p>
        <p className="truncate text-sm text-mute">
          {t(`expenses.recurring.every.${item.recurrence}`)},{' '}
          {t('expenses.paidSummary', { name: nameOf(item.paid_by), amount })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.active ? (
          <span className="tabular text-xs text-mute">
            {t('expenses.recurring.nextOn', {
              date: formatDate(item.next_run_on, { timeZone: 'UTC', style: 'dayMonth' }),
            })}
          </span>
        ) : (
          <Badge tone="neutral">{t('expenses.recurring.paused')}</Badge>
        )}
      </div>
      {allowed && (
        <div className="-mr-2 flex shrink-0">
          <IconButton
            size="sm"
            label={item.active ? t('expenses.recurring.pause') : t('expenses.recurring.resume')}
            icon={item.active ? <Pause /> : <Play />}
            onClick={() => toggle.mutate(!item.active)}
          />
          <IconButton
            size="sm"
            label={t('expenses.recurring.remove')}
            icon={<Trash2 />}
            onClick={() => setConfirm(true)}
          />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('expenses.recurring.remove')}
        description={t('expenses.recurring.removeConfirm', { description: item.description })}
        confirmLabel={t('expenses.recurring.remove')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={remove}
      />
    </li>
  )
}
