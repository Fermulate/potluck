import { avatarSrc } from '@/lib/queries'
import type { MoneyMember } from '@potluck/api'
import { firstName } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import {
  Avatar,
  AvatarStack,
  Button,
  SegmentedControl,
  Sheet,
  SheetContent,
  cn,
  controlClassName,
  useField,
} from '@potluck/ui'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Help } from '@/features/help/help'
import { joinNames } from '@/features/plans/format'
import { CompactMoneyInput } from './compact-inputs'
import { checkDraftPayers, payerIds, payersLeft, toSeveral, type PayersDraft } from './payers-state'
import { StatusPill } from './split-editor'

interface PayersFieldProps {
  members: MoneyMember[]
  viewerId: string
  value: PayersDraft
  onChange: (value: PayersDraft) => void
  totalCents: number
  currency: string
  locale: string
  refund: boolean
  disabled?: boolean
}

const nameOf = (member: MoneyMember | undefined, viewerId: string) =>
  !member
    ? t('expenses.form.formerMember')
    : member.id === viewerId
      ? t('common.you')
      : firstName(member.display_name)

/**
 * "Paid by": one tap for the usual single payer, or several people with what each paid. Opens
 * a sheet (bottom sheet on phones), like the currency picker. Lives inside a `Field`, whose
 * label names the trigger.
 */
export function PayersField({
  members,
  viewerId,
  value,
  onChange,
  totalCents,
  currency,
  locale,
  refund,
  disabled,
}: PayersFieldProps) {
  const field = useField()
  const [open, setOpen] = useState(false)
  const byId = new Map(members.map((m) => [m.id, m]))
  // The viewer first, so it reads "You and Ben".
  const ids = [
    ...payerIds(value).filter((id) => id === viewerId),
    ...payerIds(value).filter((id) => id !== viewerId),
  ]
  const people = ids.map((id) => byId.get(id))
  const check = checkDraftPayers(value, totalCents)
  const left = payersLeft(value, totalCents)
  const money = (cents: number) => formatMoney(cents, currency, { locale })
  const summary = joinNames(
    ids.map((id) => nameOf(byId.get(id), viewerId)),
    2,
  )

  return (
    <>
      <button
        type="button"
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-haspopup="dialog"
        aria-invalid={(totalCents > 0 && !check.ok) || undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          controlClassName,
          'flex h-12 items-center gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {people.length > 1 ? (
          <AvatarStack
            size="xs"
            max={3}
            people={people.map((m, i) => ({
              id: m?.id ?? ids[i]!,
              name: m?.display_name ?? '',
              src: avatarSrc(m?.avatar_path),
            }))}
          />
        ) : (
          <Avatar
            name={people[0]?.display_name ?? summary}
            seed={ids[0] ?? ''}
            src={avatarSrc(people[0]?.avatar_path)}
            size="xs"
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          {summary || t('expenses.payers.title')}
          {value.mode === 'several' && totalCents > 0 && left !== 0 && (
            <span className="ml-2 text-sm font-semibold text-tomato-ink">
              {left > 0
                ? t('expenses.remaining', { amount: money(left) })
                : t('expenses.overBy', { amount: money(-left) })}
            </span>
          )}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-mute" />
      </button>
      <PayersSheet
        open={open}
        onOpenChange={setOpen}
        members={members}
        viewerId={viewerId}
        value={value}
        onChange={onChange}
        totalCents={totalCents}
        currency={currency}
        locale={locale}
        refund={refund}
      />
    </>
  )
}

function PayersSheet({
  open,
  onOpenChange,
  members,
  viewerId,
  value,
  onChange,
  totalCents,
  currency,
  locale,
  refund,
}: Omit<PayersFieldProps, 'disabled'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const money = (cents: number) => formatMoney(cents, currency, { locale })
  const left = payersLeft(value, totalCents)
  const close = () => onOpenChange(false)
  // One tap to give what is still unpaid to the first person with nothing typed yet.
  const restTo =
    value.mode === 'several' && left > 0 ? members.find((m) => !value.amounts[m.id]) : undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={refund ? t('expenses.payers.titleRefund') : t('expenses.payers.title')}
        closeLabel={t('common.close')}
        size="sm"
        footer={
          value.mode === 'several' ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {totalCents > 0 ? (
                <StatusPill tone={left === 0 ? 'ok' : left > 0 ? 'left' : 'over'}>
                  {left === 0
                    ? t('expenses.allAssigned')
                    : left > 0
                      ? t('expenses.remaining', { amount: money(left) })
                      : t('expenses.overBy', { amount: money(-left) })}
                </StatusPill>
              ) : (
                <span />
              )}
              <span className="ml-auto flex items-center gap-1">
                {restTo && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('expenses.payers.fillRestLabel', {
                      amount: money(left),
                      name: nameOf(restTo, viewerId),
                    })}
                    onClick={() =>
                      onChange({
                        mode: 'several',
                        amounts: { ...value.amounts, [restTo.id]: left },
                      })
                    }
                  >
                    {t('expenses.payers.fillRest', { name: nameOf(restTo, viewerId) })}
                  </Button>
                )}
                <Button onClick={close}>{t('expenses.payers.done')}</Button>
              </span>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4 px-1 pb-2">
          <SegmentedControl
            block
            size="sm"
            label={refund ? t('expenses.payers.titleRefund') : t('expenses.payers.title')}
            value={value.mode}
            onValueChange={(mode) =>
              onChange(
                mode === 'several'
                  ? toSeveral(value, totalCents)
                  : { mode: 'single', paidBy: payerIds(value)[0] ?? viewerId },
              )
            }
            options={[
              { value: 'single', label: t('expenses.payers.one') },
              { value: 'several', label: t('expenses.payers.several') },
            ]}
          />
          <p className="text-sm text-mute">
            {value.mode === 'single'
              ? refund
                ? t('expenses.payers.pickOneRefund')
                : t('expenses.payers.pickOne')
              : refund
                ? t('expenses.payers.enterEachRefund')
                : t('expenses.payers.enterEach')}
          </p>
          {value.mode === 'single' ? (
            <ul className="-mx-1 flex flex-col">
              {members.map((m) => {
                const selected = value.paidBy === m.id
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onChange({ mode: 'single', paidBy: m.id })
                        close()
                      }}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-3 rounded-input px-3 py-2 text-left transition-colors hover:bg-sunken',
                        selected && 'bg-sunken',
                      )}
                    >
                      <Avatar
                        name={m.display_name}
                        seed={m.id}
                        src={avatarSrc(m.avatar_path)}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {nameOf(m, viewerId)}
                      </span>
                      {selected && (
                        <Check aria-hidden className="size-5 text-olive-ink" strokeWidth={3} />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {members.map((m) => {
                const name = nameOf(m, viewerId)
                return (
                  <li key={m.id} className="flex items-center gap-3 py-1.5">
                    <Avatar
                      name={m.display_name}
                      seed={m.id}
                      src={avatarSrc(m.avatar_path)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                    <CompactMoneyInput
                      currency={currency}
                      locale={locale}
                      value={value.amounts[m.id] ?? null}
                      onValueChange={(cents) =>
                        onChange({ mode: 'several', amounts: { ...value.amounts, [m.id]: cents } })
                      }
                      aria-label={t('expenses.payers.amountOf', { name })}
                      className="w-32"
                    />
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-t border-line pt-3">
            <Help topic={refund ? 'refunds' : 'payers'} showLabel />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
