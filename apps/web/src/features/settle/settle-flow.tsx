import { avatarSrc } from '@/lib/queries'
import { settleUp, type MoneyGroup, type MoneyMember } from '@potluck/api'
import { firstName } from '@potluck/core'
import { springs } from '@potluck/tokens'
import { DEFAULT_LOCALE, formatMoney, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Card,
  Confetti,
  Field,
  Input,
  MoneyInput,
  Skeleton,
  toast,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, ChevronRight } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useDebts } from '@/features/balances/use-debts'
import { groupTitle } from '@/features/expenses/format'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { GoodToKnow } from '@/features/help/help'
import { invalidateMoney, moneyErrorMessage, useMoneyGroup } from '@/features/expenses/money-data'

interface Done {
  to: MoneyMember
  owedBefore: number
  paid: number
}

const settleHelp = <GoodToKnow topic="settleUp" tip="settleUp" className="mr-2" />

export function SettleFlow({
  groupId,
  to,
  amount,
  onClose,
  onPickPerson,
  onFinish,
}: {
  groupId: string
  to?: string
  amount?: number
  onClose: () => void
  /** Moves between the person list (undefined) and the payment form. */
  onPickPerson: (userId: string | undefined, amount?: number) => void
  onFinish: () => void
}) {
  const me = useUserId()
  const group = useMoneyGroup(groupId)
  const debts = useDebts(groupId, group.data)
  const [done, setDone] = useState<Done | null>(null)

  if (!group.data || !debts) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={onClose}>
        <div aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </MoneyPageShell>
    )
  }

  const owedTo = (id: string) =>
    debts.find((d) => d.from_user === me && d.to_user === id)?.amount_cents ?? 0

  if (done) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={onFinish}>
        <SettledMoment
          done={done}
          currency={group.data.currency}
          groupName={groupTitle(group.data, me)}
          onFinish={onFinish}
        />
      </MoneyPageShell>
    )
  }

  const recipient = to ? group.data.members.find((m) => m.id === to && m.id !== me) : undefined
  if (!recipient) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={onClose} aside={settleHelp}>
        <PersonPicker
          group={group.data}
          owedTo={owedTo}
          onPick={(m) => onPickPerson(m.id, owedTo(m.id) || undefined)}
        />
      </MoneyPageShell>
    )
  }

  return (
    <PaymentForm
      key={recipient.id}
      group={group.data}
      recipient={recipient}
      owed={owedTo(recipient.id)}
      initialAmount={amount ?? (owedTo(recipient.id) || null)}
      onClose={onClose}
      onChangePerson={() => onPickPerson(undefined)}
      onDone={setDone}
    />
  )
}

function PersonPicker({
  group,
  owedTo,
  onPick,
}: {
  group: MoneyGroup
  owedTo: (id: string) => number
  onPick: (member: MoneyMember) => void
}) {
  const me = useUserId()
  const others = group.members.filter((m) => m.id !== me)
  const suggested = others
    .filter((m) => owedTo(m.id) > 0)
    .sort((a, b) => owedTo(b.id) - owedTo(a.id))
  const rest = others.filter((m) => owedTo(m.id) === 0)

  const row = (m: MoneyMember) => {
    const owed = owedTo(m.id)
    return (
      <li key={m.id}>
        <button
          type="button"
          onClick={() => onPick(m)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/70"
        >
          <Avatar name={m.display_name} seed={m.id} src={avatarSrc(m.avatar_path)} size="md" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{m.display_name}</span>
            {owed > 0 && (
              <span className="text-sm text-tomato-ink">
                {t('settle.youOwe', {
                  name: firstName(m.display_name),
                  amount: formatMoney(owed, group.currency),
                })}
              </span>
            )}
          </span>
          <ChevronRight aria-hidden className="size-5 text-mute" />
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-6">
      <div>
        <h2 className="font-display text-3xl leading-tight">{t('settle.pickPerson')}</h2>
        <p className="mt-1 text-[0.9375rem] text-mute">{t('settle.pickPersonHint')}</p>
      </div>
      {suggested.length > 0 && (
        <section aria-labelledby="settle-suggested" className="flex flex-col gap-2">
          <h3 id="settle-suggested" className="text-sm font-bold text-mute">
            {t('settle.suggested')}
          </h3>
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-line">{suggested.map(row)}</ul>
          </Card>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-labelledby="settle-rest" className="flex flex-col gap-2">
          <h3 id="settle-rest" className="text-sm font-bold text-mute">
            {suggested.length > 0 ? t('settle.everyoneElse') : t('balances.members')}
          </h3>
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-line">{rest.map(row)}</ul>
          </Card>
        </section>
      )}
    </div>
  )
}

function PaymentForm({
  group,
  recipient,
  owed,
  initialAmount,
  onClose,
  onChangePerson,
  onDone,
}: {
  group: MoneyGroup
  recipient: MoneyMember
  owed: number
  initialAmount: number | null
  onClose: () => void
  onChangePerson: () => void
  onDone: (done: Done) => void
}) {
  const me = useUserId()
  const formId = useId()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState<number | null>(initialAmount)
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const self = group.members.find((m) => m.id === me)
  const name = firstName(recipient.display_name)
  const error = submitted && !amount ? t('settle.amountRequired') : undefined

  const pay = useMutation({
    mutationFn: (cents: number) =>
      settleUp(supabase, {
        groupId: group.id,
        toUser: recipient.id,
        amountCents: cents,
        note: note.trim() || null,
      }),
    onSuccess: (_row, cents) => {
      invalidateMoney(queryClient, group.id)
      onDone({ to: recipient, owedBefore: owed, paid: cents })
    },
    onError: (e) => toast.error(moneyErrorMessage(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (amount && amount > 0) pay.mutate(amount)
  }

  return (
    <MoneyPageShell
      title={t('settle.title')}
      onClose={onClose}
      aside={settleHelp}
      footer={
        <Button
          type="submit"
          form={formId}
          size="lg"
          block
          loading={pay.isPending}
          leadingIcon={<Check />}
        >
          {t('settle.recordPayment')}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6 px-4 py-6 md:px-8"
      >
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <div aria-hidden className="flex items-center gap-3">
            {self && (
              <Avatar
                name={self.display_name}
                seed={self.id}
                src={avatarSrc(self.avatar_path)}
                size="lg"
              />
            )}
            <ArrowRight className="size-6 text-mute" strokeWidth={2.5} />
            <Avatar
              name={recipient.display_name}
              seed={recipient.id}
              src={avatarSrc(recipient.avatar_path)}
              size="lg"
            />
          </div>
          <h2 className="font-display text-3xl leading-tight">{t('settle.paying', { name })}</h2>
          <p className="text-sm text-mute">
            {owed > 0
              ? t('settle.youOwe', { name, amount: formatMoney(owed, group.currency) })
              : t('settle.noDebt', { name })}
          </p>
          <Button size="sm" variant="ghost" onClick={onChangePerson}>
            {t('settle.change')}
          </Button>
        </div>

        <Field label={t('settle.amount')} hideLabel error={error} className="items-center">
          <div className="w-full rounded-card bg-paper px-4 py-6">
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              currency={group.currency}
              locale={DEFAULT_LOCALE}
              autoFocus={!initialAmount}
            />
          </div>
        </Field>

        <Field label={t('settle.note')} hint={t('common.optional')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('settle.notePlaceholder')}
            maxLength={280}
          />
        </Field>
      </form>
    </MoneyPageShell>
  )
}

/**
 * Signature moment: what you owed ticks down to what is left (usually $0.00), then confetti in
 * the palette colors and a short haptic. With reduced motion it simply shows the result.
 */
export function SettledMoment({
  done,
  currency,
  groupName,
  onFinish,
}: {
  done: Done
  currency: string
  groupName: string
  onFinish: () => void
}) {
  const reduced = usePrefersReducedMotion()
  const start = Math.max(done.owedBefore, done.paid)
  const remaining = Math.max(0, done.owedBefore - done.paid)
  const settled = remaining === 0
  // Reduced motion: show the result straight away (the haptic still fires).
  const [shown, setShown] = useState(reduced ? remaining : start)
  const [fire, setFire] = useState(reduced && settled ? 1 : 0)
  const name = firstName(done.to.display_name)

  useEffect(() => {
    if (reduced) return
    const controls = animate(start, remaining, {
      duration: 1.1,
      delay: 0.25,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => {
        if (settled) setFire((n) => n + 1)
      },
    })
    return () => controls.stop()
  }, [reduced, start, remaining, settled])

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10 text-center md:py-14">
      <Confetti fire={fire} />
      <motion.div
        initial={reduced ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
        animate={{ scale: 1, rotate: -4, opacity: 1 }}
        transition={reduced ? { duration: 0 } : springs.bouncy}
        aria-hidden
        className="grid size-20 place-items-center rounded-[1.5rem] bg-olive text-on-olive"
      >
        <Check className="size-10" strokeWidth={3} />
      </motion.div>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-2">
        <p
          aria-hidden
          className={
            'tabular text-[4rem] leading-none font-extrabold tracking-tight transition-colors duration-500 ' +
            (shown === 0 ? 'text-olive-ink' : 'text-tomato-ink')
          }
        >
          {formatMoney(shown, currency, { locale: DEFAULT_LOCALE })}
        </p>
        <h2 className="font-display text-3xl leading-tight">
          {settled ? t('settle.settledTitle', { name }) : t('settle.partialTitle')}
        </h2>
        <p className="text-[0.9375rem] text-mute">
          {settled
            ? t('settle.recorded')
            : t('settle.stillOwe', { amount: formatMoney(remaining, currency) })}
        </p>
        <span className="sr-only">
          {t('settle.youPaid', { name, amount: formatMoney(done.paid, currency) })}
        </span>
      </div>
      <Button size="lg" variant="ink" onClick={onFinish}>
        {t('settle.backToGroup', { group: groupName })}
      </Button>
    </div>
  )
}
