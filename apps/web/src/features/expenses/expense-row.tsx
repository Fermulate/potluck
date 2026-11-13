import type { ExpenseWithSplits, Settlement } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import { cn } from '@potluck/ui'
import { Money } from './money'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, Repeat } from 'lucide-react'
import type { ReactNode } from 'react'
import { paidSummary, settlementText, viewerLine } from './expense-math'
import { categoryEmoji } from './format'

export function CategoryTile({
  category,
  size = 'md',
  className,
}: {
  category: string | null
  size?: 'md' | 'lg' | 'xl'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center border border-line bg-sunken leading-none select-none',
        size === 'md' && 'size-11 rounded-[0.875rem] text-[1.375rem]',
        size === 'lg' && 'size-14 rounded-[1.125rem] text-[1.875rem]',
        size === 'xl' && 'size-20 rounded-[1.5rem] text-[2.75rem]',
        className,
      )}
    >
      {categoryEmoji(category)}
    </span>
  )
}

function RowShell({
  leading,
  title,
  subtitle,
  right,
}: {
  leading: ReactNode
  title: ReactNode
  subtitle: ReactNode
  right: ReactNode
}) {
  return (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] leading-snug font-semibold text-ink">
          {title}
        </span>
        <span className="truncate text-sm text-mute">{subtitle}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">{right}</span>
    </>
  )
}

const rowClass =
  'flex min-h-[4.5rem] w-full items-center gap-3 px-4 py-3 text-left outline-offset-[-2px]'

export function ExpenseRow({
  expense,
  viewerId,
  nameOf,
  locale,
}: {
  expense: ExpenseWithSplits
  viewerId: string
  /** First name, or "You" for the viewer. */
  nameOf: (id: string) => string
  locale?: string
}) {
  const line = viewerLine(expense, viewerId)
  const subtitle = paidSummary(expense, viewerId, nameOf, locale)
  const refund = expense.is_refund
  const lineAmount =
    line.kind === 'none' ? '' : formatMoney(line.cents, expense.currency, { locale })

  return (
    <Link
      to="/expenses/$expenseId"
      params={{ expenseId: expense.id }}
      className={cn(rowClass, 'transition-colors duration-150 hover:bg-sunken/70 active:bg-sunken')}
    >
      <RowShell
        leading={<CategoryTile category={expense.category} />}
        title={
          <>
            {expense.description}
            {refund && (
              <span className="ml-2 inline-flex -translate-y-px items-center rounded-pill bg-olive-soft px-2 py-0.5 align-middle text-[0.6875rem] font-bold text-olive-ink">
                {t('expenses.refund.badge')}
              </span>
            )}
            {expense.recurring_id && (
              <Repeat
                aria-hidden
                className="ml-1.5 inline size-3.5 -translate-y-px text-mute"
                strokeWidth={2.5}
              />
            )}
          </>
        }
        subtitle={subtitle}
        right={
          line.kind === 'none' ? (
            <span className="text-xs text-mute">{t('expenses.notInvolved')}</span>
          ) : (
            <>
              <span
                aria-hidden
                className={cn(
                  'text-xs font-medium',
                  line.kind === 'lent' ? 'text-saffron-ink' : 'text-tomato-ink',
                )}
              >
                {line.kind === 'lent'
                  ? refund
                    ? t('expenses.refund.youGetBackLabel')
                    : t('expenses.youLentLabel')
                  : refund
                    ? t('expenses.refund.youOweLabel')
                    : t('expenses.youBorrowedLabel')}
              </span>
              <Money
                cents={line.cents}
                currency={expense.currency}
                locale={locale}
                tone={line.kind === 'lent' ? 'owed' : 'owe'}
                className="text-[0.9375rem] font-bold"
                srLabel={
                  line.kind === 'lent'
                    ? refund
                      ? t('expenses.refund.youGetBack', { amount: lineAmount })
                      : t('expenses.youLent', { amount: lineAmount })
                    : refund
                      ? t('expenses.refund.youOwe', { amount: lineAmount })
                      : t('expenses.youBorrowed', { amount: lineAmount })
                }
              />
            </>
          )
        }
      />
    </Link>
  )
}

export function SettlementRow({
  settlement,
  viewerId,
  nameOf,
  locale,
  actions,
}: {
  settlement: Settlement
  viewerId: string
  nameOf: (id: string) => string
  locale?: string
  /** A menu button at the end of the row. */
  actions?: ReactNode
}) {
  const text = settlementText(settlement, viewerId, nameOf, locale)
  return (
    <div className={cn(rowClass, actions && 'pr-2')}>
      <RowShell
        leading={
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-[0.875rem] bg-olive-soft text-olive-ink"
          >
            <ArrowRightLeft className="size-5" />
          </span>
        }
        title={text}
        subtitle={settlement.note ?? t('balances.settledShort')}
        right={
          <Money
            cents={settlement.amount_cents}
            currency={settlement.currency}
            locale={locale}
            tone="settled"
            className="text-[0.9375rem] font-bold"
          />
        }
      />
      {actions}
    </div>
  )
}
