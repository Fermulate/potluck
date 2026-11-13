import {
  makeExpenseRecurring,
  moneyKeys,
  moneyQueries,
  type ExpenseWithSplits,
  type RecurringExpense,
} from '@potluck/api'
import { RECURRENCES, type Recurrence } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'
import { Button, Sheet, SheetContent, buttonClassName, cn, toast } from '@potluck/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, Repeat } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { todayIn } from '@/features/expenses/format'
import { moneyErrorMessage } from '@/features/expenses/money-data'
import { Help } from '@/features/help/help'
import { SkipButton } from './template-actions'
import { firstRepeat } from './template'

const day = (date: string) => formatDate(date, { timeZone: 'UTC', style: 'weekday' })

/**
 * On an expense's page: the series it belongs to (how often, when the next one comes, a way into
 * its editor), or, for an expense that could repeat, "Make it repeat".
 */
export function RepeatCard({
  expense,
  canManage,
  canMakeRepeat,
  timeZone,
}: {
  expense: Pick<ExpenseWithSplits, 'id' | 'group_id' | 'description' | 'recurring_id' | 'spent_at'>
  /** Whether the viewer may change the series (whoever set it up, or an admin). */
  canManage: (template: RecurringExpense) => boolean
  /** May start a series from this expense (someone who may edit it, not a refund, nobody left). */
  canMakeRepeat: boolean
  timeZone: string
}) {
  const template = useQuery({
    ...moneyQueries.recurringOne(supabase, expense.recurring_id ?? ''),
    enabled: !!expense.recurring_id,
  })
  if (expense.recurring_id) {
    return template.data ? (
      <SeriesCard template={template.data} canManage={canManage(template.data)} />
    ) : null
  }
  return canMakeRepeat ? <MakeRepeat expense={expense} timeZone={timeZone} /> : null
}

function SeriesCard({ template, canManage }: { template: RecurringExpense; canManage: boolean }) {
  const every = t(`expenses.recurring.every.${template.recurrence}`)
  return (
    <section
      aria-labelledby="repeat-title"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-plum-soft px-4 py-3 text-plum-ink"
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-card/70">
        <Repeat className="size-4" strokeWidth={2.5} />
      </span>
      {/* At least 12rem for the words, so on a phone the buttons drop to their own line. */}
      <div className="min-w-48 flex-1">
        <h2 id="repeat-title" className="text-sm font-bold">
          {t('expenses.recurring.card.title')}
        </h2>
        <p className="text-sm">
          {template.active
            ? t('expenses.recurring.card.next', { every, date: day(template.next_run_on) })
            : t('expenses.recurring.card.paused', { every })}
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {canManage && template.active && <SkipButton template={template} />}
        <Link
          to="/recurring/$recurringId"
          params={{ recurringId: template.id }}
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          {canManage ? t('expenses.recurring.card.edit') : t('expenses.recurring.card.view')}
        </Link>
      </div>
    </section>
  )
}

function MakeRepeat({
  expense,
  timeZone,
}: {
  expense: Pick<ExpenseWithSplits, 'id' | 'group_id' | 'description' | 'spent_at'>
  timeZone: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [recurrence, setRecurrence] = useState<Recurrence>('monthly')
  const first = firstRepeat(expense.spent_at, recurrence, todayIn(timeZone))

  const make = useMutation({
    mutationFn: () => makeExpenseRecurring(supabase, expense.id, recurrence),
    onSuccess: (template) => {
      queryClient.setQueryData(moneyKeys.recurringOne(template.id), template)
      void queryClient.invalidateQueries({ queryKey: moneyKeys.expense(expense.id) })
      void queryClient.invalidateQueries({ queryKey: moneyKeys.group(expense.group_id) })
      void queryClient.invalidateQueries({ queryKey: moneyKeys.activity() })
      toast.success(
        t('expenses.recurring.make.doneToast', {
          description: template.description,
          date: day(template.next_run_on),
        }),
      )
      setOpen(false)
    },
    onError: (error) => toast.error(moneyErrorMessage(error)),
  })

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3 text-left transition-colors hover:border-ink/40 hover:bg-sunken"
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-plum-soft text-plum-ink"
        >
          <Repeat className="size-4" strokeWidth={2.5} />
        </span>
        <span className="font-semibold">{t('expenses.recurring.make.action')}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title={t('expenses.recurring.make.title')}
          description={t('expenses.recurring.make.hint')}
          closeLabel={t('common.close')}
          size="sm"
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-plum-ink" aria-live="polite">
                {t('expenses.recurring.make.first', { date: day(first) })}
              </p>
              <Button loading={make.isPending} onClick={() => make.mutate()}>
                {t('expenses.recurring.make.confirm')}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 px-1 pb-2">
            {/* Radios straight inside the radiogroup: list markup around them would split the
                group for assistive tech. */}
            <div
              role="radiogroup"
              aria-label={t('expenses.fields.recurring')}
              className="-mx-1 flex flex-col"
            >
              {RECURRENCES.map((r) => {
                const selected = r === recurrence
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRecurrence(r)}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-input px-3 py-2 text-left font-semibold transition-colors hover:bg-sunken',
                      selected && 'bg-sunken',
                    )}
                  >
                    <span className="flex-1">{t(`expenses.recurrence.${r}`)}</span>
                    {selected && (
                      <Check aria-hidden className="size-5 text-olive-ink" strokeWidth={3} />
                    )}
                  </button>
                )
              })}
            </div>
            <div className="border-t border-line pt-3">
              <Help topic="recurring" showLabel />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
