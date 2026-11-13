import { moneyQueries, type MoneyGroup, type RecurringExpense } from '@potluck/api'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { Button, EmptyState, Skeleton } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { ExpenseForm } from '@/features/expenses/form/expense-form'
import { categoryEmoji } from '@/features/expenses/format'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { useMoneyGroup, useNameOf, usePeople } from '@/features/expenses/money-data'
import { joinNames } from '@/features/plans/format'
import { firstName } from '@potluck/core'
import { TemplateActions } from './template-actions'
import { draftFromExpense, previewSplit } from '@/features/expenses/form/split-state'
import { canManageTemplate, templateAsExpense, templateDeparted } from './template'

/**
 * A repeating expense opened from the group's list, a posted copy or a heads-up: the expense form
 * for whoever set it up or an admin, a short summary for everyone else.
 */
export function RecurringEditScreen({ recurringId }: { recurringId: string }) {
  const me = useUserId()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const people = usePeople()
  const template = useQuery(moneyQueries.recurringOne(supabase, recurringId))
  const group = useMoneyGroup(template.data?.group_id)
  const groupId = template.data?.group_id
  const close = () => {
    if (canGoBack) router.history.back()
    else if (groupId) void navigate({ to: '/groups/$groupId', params: { groupId } })
    else void navigate({ to: '/groups' })
  }
  const title = t('expenses.recurring.editTitle')

  if (template.isError || template.data === null) {
    return (
      <MoneyPageShell title={title} onClose={close}>
        <div className="px-4 py-10 md:px-8">
          <EmptyState
            illustration="🔁"
            title={t('errors.notFound')}
            description={t('expenses.recurring.notFound')}
            action={
              <Button asChild variant="secondary">
                <Link to="/groups">{t('nav.groups')}</Link>
              </Button>
            }
          />
        </div>
      </MoneyPageShell>
    )
  }

  if (!template.data || !group.data) {
    return (
      <MoneyPageShell title={title} onClose={close} width="lg">
        <div
          aria-busy="true"
          aria-label={t('common.loading')}
          className="flex flex-col items-center gap-6 p-6"
        >
          <Skeleton className="h-20 w-56" />
          <Skeleton className="h-12 w-full max-w-md" />
          <Skeleton className="h-40 w-full max-w-md" />
        </div>
      </MoneyPageShell>
    )
  }

  const role = group.data.members.find((m) => m.id === me)?.role
  const allowed = canManageTemplate(template.data, role, me, !!group.data.archived_at)
  if (!allowed) {
    return <TemplateSummary template={template.data} group={group.data} onClose={close} />
  }
  const departed = templateDeparted(
    template.data,
    group.data.members.map((m) => m.id),
  )
  const departedNames = departed.length
    ? joinNames(
        departed.map((id) =>
          firstName(people.get(id)?.display_name ?? t('expenses.form.formerMember')),
        ),
        3,
      )
    : undefined

  return (
    <ExpenseForm
      // Keyed by id only: a skip or pause while it is open keeps unsaved edits (the form follows
      // a new next date until the date is changed here).
      key={template.data.id}
      mode="recurring"
      template={template.data}
      actions={
        <TemplateActions template={template.data} departedNames={departedNames} onStopped={close} />
      }
      onDone={close}
      onClose={close}
    />
  )
}

/**
 * What people who cannot change it see: what it is, when it comes, who pays, how it splits, and
 * who can change it.
 */
function TemplateSummary({
  template,
  group,
  onClose,
}: {
  template: RecurringExpense
  group: MoneyGroup
  onClose: () => void
}) {
  const me = useUserId()
  const nameOf = useNameOf()
  const every = t(`expenses.recurring.every.${template.recurrence}`)
  const date = formatDate(template.next_run_on, { timeZone: 'UTC', style: 'weekday' })
  const shape = templateAsExpense(template)
  const memberIds = group.members.map((m) => m.id)
  // Each person's part of every copy, worked out the way the form previews a split.
  const preview = previewSplit(draftFromExpense(shape, memberIds), template.amount_cents)
  const shares = preview.ok ? preview.shares : {}
  const mine = shares[me] ?? 0
  const money = (cents: number) => formatMoney(cents, template.currency)
  const payers = [
    ...shape.expense_payers.filter((p) => p.user_id === me),
    ...shape.expense_payers.filter((p) => p.user_id !== me),
  ]
  const paid =
    payers.length > 1
      ? t('expenses.payers.paidMany', {
          names: joinNames(
            payers.map((p) => nameOf(p.user_id)),
            3,
          ),
          amount: money(template.amount_cents),
        })
      : t('expenses.paidSummary', {
          name: nameOf(payers[0]?.user_id ?? template.paid_by),
          amount: money(template.amount_cents),
        })
  const splitIds = Object.keys(shares).filter((id) => (shares[id] ?? 0) > 0)
  return (
    <MoneyPageShell title={t('expenses.recurring.card.title')} onClose={onClose}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-10 text-center">
        <span aria-hidden className="text-5xl leading-none">
          {categoryEmoji(template.category)}
        </span>
        <h2 className="font-display text-3xl leading-tight text-balance">{template.description}</h2>
        <p className="tabular text-2xl font-extrabold">{money(template.amount_cents)}</p>
        <p className="text-mute">
          {template.active
            ? t('expenses.recurring.card.next', { every, date })
            : t('expenses.recurring.card.paused', { every })}
        </p>
        <p className="font-semibold">{paid}</p>
        {mine > 0 && (
          <p className="font-semibold text-plum-ink">
            {t('expenses.recurring.yourShare', { amount: money(mine) })}
          </p>
        )}
        {splitIds.length > 0 && (
          <section aria-labelledby="summary-split" className="mt-2 w-full text-left">
            <h3 id="summary-split" className="mb-1 text-sm font-semibold text-mute">
              {t('expenses.fields.splitBetween')}
            </h3>
            <ul className="divide-y divide-line rounded-card border border-line bg-card">
              {splitIds.map((id) => (
                <li key={id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate font-semibold">{nameOf(id)}</span>
                  <span className="tabular">{money(shares[id] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {template.notes && (
          <p className="w-full rounded-card bg-sunken px-4 py-3 text-left text-sm whitespace-pre-wrap">
            {template.notes}
          </p>
        )}
        <p role="note" className="mt-2 rounded-card bg-sunken px-4 py-3 text-sm text-mute">
          {group.archived_at
            ? t('expenses.form.archived', { group: group.name })
            : t('expenses.recurring.readOnly')}
        </p>
      </div>
    </MoneyPageShell>
  )
}
