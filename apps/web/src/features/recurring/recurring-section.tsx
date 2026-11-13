import { moneyQueries, type RecurringExpense } from '@potluck/api'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Badge, Card, ConfirmDialog, IconButton, cn } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Pause, Play, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { categoryEmoji } from '@/features/expenses/format'
import { Help } from '@/features/help/help'
import { useMoneyGroup, useNameOf } from '@/features/expenses/money-data'
import { joinNames } from '@/features/plans/format'
import { SkipButton } from './template-actions'
import { canManageTemplate, templateAsExpense, templateDeparted } from './template'
import { useTemplateActions } from './use-template-actions'

/**
 * Repeating expenses for a group, folded away under the search bar. Each row opens the
 * repeating expense; the creator or an admin can also pause, resume, or stop it from here.
 */
export function RecurringSection({ groupId }: { groupId: string }) {
  const { data } = useQuery(moneyQueries.recurring(supabase, groupId))
  const [open, setOpen] = useState(false)
  if (!data || data.length === 0) return null
  const active = data.filter((r) => r.active).length
  const paused = data.length - active
  const summary = [
    active > 0 ? t('expenses.recurring.activeCount', { count: active }) : null,
    paused > 0 ? t('expenses.recurring.pausedCount', { count: paused }) : null,
  ]
    .filter(Boolean)
    .join(', ')

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
        <span className="tabular text-sm text-mute">{summary}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 text-mute transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={`recurring-${groupId}`} className="border-t border-line bg-card">
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <p className="text-sm text-mute">
              {t('expenses.recurring.hint')} {t('help.recurringEdit')}
            </p>
            <Help topic="recurringEdit" className="mt-px" />
          </div>
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
  const group = useMoneyGroup(groupId)
  const [confirm, setConfirm] = useState(false)
  const role = group.data?.members.find((m) => m.id === me)?.role
  const allowed = canManageTemplate(item, role, me, !!group.data?.archived_at)
  // Someone it names left: it cannot post (and the job pauses it) until they are taken out.
  const departed = group.data ? templateDeparted(item, group.data.members) : []
  const departedNames = departed.length
    ? joinNames(
        departed.map((id) => nameOf(id)),
        2,
      )
    : undefined
  const { toggle, remove } = useTemplateActions(item, departedNames)

  const shape = templateAsExpense(item)
  const amount = formatMoney(item.amount_cents, item.currency)
  const paid =
    shape.expense_payers.length > 1
      ? t('expenses.payers.paidMany', {
          // The viewer first, so it reads "You and Ben".
          names: joinNames(
            [
              ...shape.expense_payers.filter((p) => p.user_id === me),
              ...shape.expense_payers.filter((p) => p.user_id !== me),
            ].map((p) => nameOf(p.user_id)),
            2,
          ),
          amount,
        })
      : item.paid_by === me
        ? t('expenses.youPaid', { amount })
        : t('expenses.paidSummary', { name: nameOf(item.paid_by), amount })
  return (
    <li className="flex items-center gap-1 pr-4 transition-colors hover:bg-sunken/60">
      {/* The row opens the repeating expense: its editor, or a summary for everyone else. Its
          name is what it shows, so a voice command can say what it reads. */}
      <Link
        to="/recurring/$recurringId"
        params={{ recurringId: item.id }}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 outline-offset-[-2px]"
      >
        <span aria-hidden className="text-2xl leading-none">
          {categoryEmoji(item.category)}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate font-semibold', !item.active && 'text-mute')}>
            {item.description}
          </p>
          <p className="truncate text-sm text-mute">
            {t(`expenses.recurring.every.${item.recurrence}`)}, {paid}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-mute">
            {departedNames ? (
              <Badge tone="saffron">
                {item.active
                  ? t('expenses.recurring.left', { names: departedNames })
                  : t('expenses.recurring.pausedLeft', { names: departedNames })}
              </Badge>
            ) : item.active ? (
              <span className="tabular">
                {t('expenses.recurring.nextOn', {
                  date: formatDate(item.next_run_on, { timeZone: 'UTC', style: 'dayMonth' }),
                })}
              </span>
            ) : (
              <Badge tone="neutral">{t('expenses.recurring.paused')}</Badge>
            )}
          </p>
        </div>
      </Link>
      {allowed && (
        <div className="-mr-2 flex shrink-0">
          {item.active && !departedNames && <SkipButton template={item} variant="icon" />}
          <IconButton
            size="sm"
            label={item.active ? t('expenses.recurring.pause') : t('expenses.recurring.resume')}
            icon={item.active ? <Pause /> : <Play />}
            disabled={!item.active && !!departedNames}
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
        onConfirm={() => remove.mutateAsync()}
      />
    </li>
  )
}
