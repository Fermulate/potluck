import { avatarSrc } from '@/lib/queries'
import {
  paymentKeys,
  recordPayment,
  updateSettlement,
  type Debt,
  type MoneyGroup,
  type MoneyMember,
  type PaymentUpdate,
  type Settlement,
} from '@potluck/api'
import { dayKey, firstName, paymentProblem } from '@potluck/core'
import { springs } from '@potluck/tokens'
import { formatMoney, intlLocale, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Card,
  Confetti,
  Field,
  IconButton,
  Input,
  MoneyInput,
  Select,
  Skeleton,
  toast,
  usePrefersReducedMotion,
} from '@potluck/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Check, ChevronRight } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useUserId } from '@/lib/auth'
import { isNetworkError } from '@/lib/errors'
import { useOnline, useWarnBeforeUnload } from '@/lib/online'
import { OfflineSaveNote } from '@/features/shell/offline'
import { supabase } from '@/lib/supabase'
import { useDebts } from '@/features/balances/use-debts'
import { groupTitle, todayIn } from '@/features/expenses/format'
import { ConversionPreview } from '@/features/expenses/form/conversion-preview'
import { CurrencyPicker } from '@/features/expenses/form/currency-picker'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { GoodToKnow } from '@/features/help/help'
import {
  invalidateMoney,
  moneyErrorMessage,
  useMoneyGroup,
  usePeople,
  useTimeZone,
} from '@/features/expenses/money-data'
import { PayWith } from './pay-with'

export interface SettledPayment {
  from: MoneyMember
  to: MoneyMember
  /** What `from` owed `to` before, in the group currency. */
  owedBefore: number
  paid: number
  currency: string
}

/** Moves between the person list (no people) and the payment form. */
export interface PickPerson {
  from?: string
  to?: string
  amount?: number
}

/** Long names end in an ellipsis inside a Select instead of pushing the field wider. */
const TRUNCATE = 'min-w-0 [&>span:first-child]:min-w-0 [&>span:first-child]:truncate'

const settleHelp = <GoodToKnow topic="settleUp" tip="settleUp" className="mr-2" />

/** What `from` owes `to` in `debts`, or 0. */
function owedBetween(debts: readonly Debt[], from: string, to: string): number {
  return debts.find((d) => d.from_user === from && d.to_user === to)?.amount_cents ?? 0
}

export function SettleFlow({
  groupId,
  from,
  to,
  amount,
  onClose,
  onPickPerson,
  onFinish,
}: {
  groupId: string
  from?: string
  to?: string
  amount?: number
  onClose: () => void
  onPickPerson: (pick: PickPerson | undefined) => void
  onFinish: () => void
}) {
  const me = useUserId()
  const group = useMoneyGroup(groupId)
  const debts = useDebts(groupId, group.data)
  const [done, setDone] = useState<SettledPayment | null>(null)

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

  if (done) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={onFinish}>
        <SettledMoment
          done={done}
          viewerId={me}
          groupCurrency={group.data.currency}
          groupName={groupTitle(group.data, me)}
          onFinish={onFinish}
        />
      </MoneyPageShell>
    )
  }

  const member = (id: string | undefined) => group.data!.members.find((m) => m.id === id)
  // One side given: the viewer is the other side.
  const payer = member(from ?? (to ? me : undefined))
  const payee = member(to ?? (from ? me : undefined))
  if (!payer || !payee || payer.id === payee.id) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={onClose} aside={settleHelp}>
        <PersonPicker group={group.data} debts={debts} onPick={onPickPerson} />
      </MoneyPageShell>
    )
  }

  return (
    <PaymentForm
      key={`${payer.id}-${payee.id}`}
      group={group.data}
      debts={debts}
      initialFrom={payer.id}
      initialTo={payee.id}
      initialAmount={amount ?? (owedBetween(debts, payer.id, payee.id) || null)}
      onClose={onClose}
      onDone={setDone}
    />
  )
}

function PersonPicker({
  group,
  debts,
  onPick,
}: {
  group: MoneyGroup
  debts: readonly Debt[]
  onPick: (pick: PickPerson) => void
}) {
  const me = useUserId()
  const others = group.members.filter((m) => m.id !== me)
  const iOwe = (id: string) => owedBetween(debts, me, id)
  const owesMe = (id: string) => owedBetween(debts, id, me)
  const pay = others.filter((m) => iOwe(m.id) > 0).sort((a, b) => iOwe(b.id) - iOwe(a.id))
  const collect = others.filter((m) => owesMe(m.id) > 0).sort((a, b) => owesMe(b.id) - owesMe(a.id))
  const rest = others.filter((m) => iOwe(m.id) === 0 && owesMe(m.id) === 0)

  const row = (
    m: MoneyMember,
    line: string | null,
    pick: PickPerson,
    tone: 'owe' | 'owed' | null,
  ) => (
    <li key={m.id}>
      <button
        type="button"
        onClick={() => onPick(pick)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken/70"
      >
        <Avatar name={m.display_name} seed={m.id} src={avatarSrc(m.avatar_path)} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{m.display_name}</span>
          {line && (
            <span
              className={tone === 'owe' ? 'text-sm text-tomato-ink' : 'text-sm text-saffron-ink'}
            >
              {line}
            </span>
          )}
        </span>
        <ChevronRight aria-hidden className="size-5 text-mute" />
      </button>
    </li>
  )

  const section = (id: string, title: string, items: ReactNode[]) =>
    items.length > 0 && (
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <h3 id={id} className="text-sm font-bold text-mute">
          {title}
        </h3>
        <Card padding="none" className="overflow-hidden">
          <ul className="divide-y divide-line">{items}</ul>
        </Card>
      </section>
    )

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-6">
      <div>
        <h2 className="font-display text-3xl leading-tight">{t('settle.pickPerson')}</h2>
        <p className="mt-1 text-[0.9375rem] text-mute">{t('settle.pickPersonHint')}</p>
      </div>
      {section(
        'settle-pay',
        t('settle.youOweSection'),
        pay.map((m) =>
          row(
            m,
            t('settle.youOwe', {
              name: firstName(m.display_name),
              amount: formatMoney(iOwe(m.id), group.currency),
            }),
            { to: m.id, amount: iOwe(m.id) },
            'owe',
          ),
        ),
      )}
      {section(
        'settle-collect',
        t('settle.owedSection'),
        collect.map((m) =>
          row(
            m,
            t('settle.owesYou', {
              name: firstName(m.display_name),
              amount: formatMoney(owesMe(m.id), group.currency),
            }),
            { from: m.id, amount: owesMe(m.id) },
            'owed',
          ),
        ),
      )}
      {section(
        'settle-rest',
        pay.length + collect.length > 0 ? t('settle.everyoneElse') : t('balances.members'),
        rest.map((m) => row(m, null, { to: m.id }, null)),
      )}
    </div>
  )
}

/**
 * Records a new payment, or edits `editing`. Anyone can pay or be paid; owners and admins can
 * also record a payment between two other people (the server checks the same rule).
 */
export function PaymentForm({
  group,
  debts,
  initialFrom,
  initialTo,
  initialAmount,
  editing,
  onClose,
  onDone,
}: {
  group: MoneyGroup
  debts: readonly Debt[]
  initialFrom: string
  initialTo: string
  initialAmount: number | null
  editing?: Settlement
  onClose: () => void
  onDone: (done: SettledPayment) => void
}) {
  const me = useUserId()
  const people = usePeople()
  const timeZone = useTimeZone()
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const queryClient = useQueryClient()
  const today = todayIn(timeZone)
  const savedDay = editing ? dayKey(editing.settled_at, timeZone) : today
  const [fromUser, setFromUser] = useState(initialFrom)
  const [toUser, setToUser] = useState(initialTo)
  const [amount, setAmount] = useState<number | null>(initialAmount)
  const [currency, setCurrency] = useState(editing?.currency ?? group.currency)
  const [day, setDay] = useState(savedDay)
  const [note, setNote] = useState(editing?.note ?? '')
  const [pickingCurrency, setPickingCurrency] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const memberIds = group.members.map((m) => m.id)
  const role = group.members.find((m) => m.id === me)?.role
  // Someone who left can still be in an older payment; only its note and day can change.
  const person = (id: string): MoneyMember =>
    group.members.find((m) => m.id === id) ?? {
      id,
      display_name: people.get(id)?.display_name ?? t('expenses.form.formerMember'),
      avatar_path: people.get(id)?.avatar_path ?? null,
      deleted_at: null,
      role: 'member',
    }
  const locked =
    !!editing && (!memberIds.includes(editing.from_user) || !memberIds.includes(editing.to_user))
  const payer = person(fromUser)
  const payee = person(toUser)
  const owed = owedBetween(debts, fromUser, toUser)
  const problem = locked
    ? null
    : paymentProblem({
        viewerId: me,
        viewerRole: role,
        fromUser,
        toUser,
        amountCents: amount,
        memberIds,
      })
  const error =
    problem === 'invalid_amount'
      ? submitted
        ? t('settle.amountRequired')
        : undefined
      : problem
        ? t(`expenses.errors.${problem}`)
        : undefined

  const pay = useMutation({
    mutationFn: (cents: number) => {
      const trimmed = note.trim() || null
      if (editing) {
        const patch: PaymentUpdate = {}
        if (fromUser !== editing.from_user) patch.fromUser = fromUser
        if (toUser !== editing.to_user) patch.toUser = toUser
        if (cents !== editing.amount_cents) patch.amountCents = cents
        if (currency !== editing.currency) patch.currency = currency
        if (trimmed !== (editing.note ?? null)) patch.note = trimmed
        if (day !== savedDay) patch.settledOn = day
        return updateSettlement(supabase, editing.id, patch)
      }
      return recordPayment(supabase, {
        groupId: group.id,
        fromUser,
        toUser,
        amountCents: cents,
        currency: currency === group.currency ? undefined : currency,
        note: trimmed,
        settledOn: day === today ? null : day,
      })
    },
    onSuccess: (_row, cents) => {
      invalidateMoney(queryClient, group.id)
      void queryClient.invalidateQueries({ queryKey: paymentKeys.friendBalances() })
      if (editing) {
        void queryClient.invalidateQueries({ queryKey: paymentKeys.settlement(editing.id) })
        toast.success(t('settle.updated'))
      }
      onDone({ from: payer, to: payee, owedBefore: owed, paid: cents, currency })
    },
    onError: (e) => {
      if (!isNetworkError(e)) toast.error(moneyErrorMessage(e))
    },
  })

  // Offline, recording waits with the form filled in, as in the expense form.
  const online = useOnline()
  const unreached = pay.isError && isNetworkError(pay.error)
  useWarnBeforeUnload(unreached || (!online && amount !== null))

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!online) return
    setSubmitted(true)
    if (problem || !amount) return
    pay.mutate(amount)
  }

  const swap = () => {
    setFromUser(toUser)
    setToUser(fromUser)
    const back = owedBetween(debts, toUser, fromUser)
    if (!editing && back > 0 && (amount === null || amount === owed)) setAmount(back)
  }

  const nameOf = (m: MoneyMember) => (m.id === me ? t('common.you') : firstName(m.display_name))
  const heading =
    fromUser === me
      ? t('settle.paying', { name: firstName(payee.display_name) })
      : toUser === me
        ? t('settle.receiving', { name: firstName(payer.display_name) })
        : t('settle.between', { from: nameOf(payer), to: nameOf(payee) })
  const fmt = (cents: number) => formatMoney(cents, group.currency)
  const debtLine =
    owed > 0
      ? fromUser === me
        ? t('settle.youOwe', { name: firstName(payee.display_name), amount: fmt(owed) })
        : toUser === me
          ? t('settle.owesYou', { name: firstName(payer.display_name), amount: fmt(owed) })
          : t('settle.owes', { from: nameOf(payer), to: nameOf(payee), amount: fmt(owed) })
      : fromUser === me
        ? t('settle.noDebt', { name: firstName(payee.display_name) })
        : toUser === me
          ? t('settle.noDebtFrom', { name: firstName(payer.display_name) })
          : t('settle.noDebtBetween', { from: nameOf(payer), to: nameOf(payee) })

  const options = [...group.members, ...(locked ? [payer, payee] : [])]
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
    .map((m) => ({
      value: m.id,
      label: m.id === me ? t('common.you') : m.display_name,
      icon: <Avatar name={m.display_name} seed={m.id} src={avatarSrc(m.avatar_path)} size="xs" />,
    }))

  return (
    <MoneyPageShell
      title={editing ? t('settle.editTitle') : t('settle.title')}
      onClose={onClose}
      aside={settleHelp}
      footer={
        <div className="flex flex-col gap-2">
          {error && problem !== 'invalid_amount' && (
            <p role="alert" className="text-sm font-medium text-tomato-ink">
              {error}
            </p>
          )}
          <OfflineSaveNote failed={unreached} onRetry={submit} />
          <Button
            type="submit"
            form={formId}
            size="lg"
            block
            loading={pay.isPending}
            disabled={!online && !pay.isPending}
            leadingIcon={<Check />}
          >
            {editing ? t('settle.saveChanges') : t('settle.recordPayment')}
          </Button>
        </div>
      }
    >
      <form
        ref={formRef}
        id={formId}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6 px-4 py-6 md:px-8"
      >
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <div className="flex items-center gap-2">
            <span aria-hidden>
              <Avatar
                name={payer.display_name}
                seed={payer.id}
                src={avatarSrc(payer.avatar_path)}
                size="lg"
              />
            </span>
            {locked ? (
              <ArrowLeftRight aria-hidden className="mx-2 size-6 text-mute" />
            ) : (
              <IconButton
                label={t('settle.swap')}
                icon={<ArrowLeftRight />}
                variant="secondary"
                onClick={swap}
              />
            )}
            <span aria-hidden>
              <Avatar
                name={payee.display_name}
                seed={payee.id}
                src={avatarSrc(payee.avatar_path)}
                size="lg"
              />
            </span>
          </div>
          <h2 className="font-display text-3xl leading-tight">{heading}</h2>
          <p className="text-sm text-mute">{debtLine}</p>
        </div>

        {locked && (
          <p role="note" className="text-sm font-medium text-saffron-ink">
            {t('settle.detail.departedLocked')}
          </p>
        )}

        <div className="flex flex-col items-center gap-3 rounded-card bg-paper px-4 py-6">
          <Field
            label={t('settle.amount')}
            hideLabel
            error={problem === 'invalid_amount' ? error : undefined}
            className="w-full items-center"
          >
            {locked ? (
              <span className="text-[3rem] leading-none font-extrabold tracking-tight">
                {formatMoney(amount ?? 0, currency, { locale: intlLocale() })}
              </span>
            ) : (
              <MoneyInput
                // Swapping who paid can fill in the other direction's amount.
                key={`${fromUser}-${toUser}`}
                value={amount}
                onValueChange={setAmount}
                currency={currency}
                locale={intlLocale()}
                onCurrencyPress={() => setPickingCurrency(true)}
                currencyButtonLabel={`${t('settle.currency')}, ${currency}`}
                autoFocus={!initialAmount}
                className="w-full"
              />
            )}
          </Field>
          {!!amount && amount > 0 && (
            <ConversionPreview
              amountCents={amount}
              currency={currency}
              groupCurrency={group.currency}
              spentAt={day}
              savedRate={
                editing && editing.currency === currency && day === savedDay
                  ? editing.fx_rate
                  : undefined
              }
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('settle.paidBy')} className="min-w-0">
            <Select
              value={fromUser}
              onValueChange={setFromUser}
              options={options}
              disabled={locked}
              className={TRUNCATE}
            />
          </Field>
          <Field label={t('settle.paidTo')} className="min-w-0">
            <Select
              value={toUser}
              onValueChange={setToUser}
              options={options}
              disabled={locked}
              className={TRUNCATE}
            />
          </Field>
          <Field label={t('settle.date')}>
            <Input
              type="date"
              value={day}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
            />
          </Field>
          <Field label={t('settle.note')} hint={t('common.optional')}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('settle.notePlaceholder')}
              maxLength={280}
            />
          </Field>
        </div>

        {!editing && fromUser === me && toUser !== me && (
          <PayWith
            recipient={payee}
            amountCents={amount}
            currency={currency}
            note={note.trim() || undefined}
            onConfirmed={() => formRef.current?.requestSubmit()}
          />
        )}
      </form>
      <CurrencyPicker
        open={pickingCurrency}
        onOpenChange={setPickingCurrency}
        value={currency}
        groupCurrency={group.currency}
        spentAt={day}
        onSelect={setCurrency}
      />
    </MoneyPageShell>
  )
}

/**
 * Signature moment. Settling in full: what was owed ticks down to $0.00, then confetti in the
 * palette colors. Paying part: the amount just paid is the headline and what is left sits
 * underneath in plain type, so the screen celebrates the payment rather than the debt. With
 * reduced motion it simply shows the result. A payment in another currency skips the count,
 * since its group currency value is the server's to work out.
 */
export function SettledMoment({
  done,
  viewerId,
  groupCurrency,
  groupName,
  onFinish,
}: {
  done: SettledPayment
  viewerId: string
  groupCurrency: string
  groupName: string
  onFinish: () => void
}) {
  const reduced = usePrefersReducedMotion()
  const sameCurrency = done.currency === groupCurrency
  const start = sameCurrency ? Math.max(done.owedBefore, done.paid) : 0
  const remaining = sameCurrency ? Math.max(0, done.owedBefore - done.paid) : 0
  const settled = sameCurrency && remaining === 0
  // Only settling in full counts down; reduced motion shows the result straight away.
  const counts = settled && !reduced
  const [shown, setShown] = useState(counts ? start : remaining)
  const [fire, setFire] = useState(reduced && settled ? 1 : 0)
  const from = firstName(done.from.display_name)
  const to = firstName(done.to.display_name)
  const youPaid = done.from.id === viewerId
  const youGot = done.to.id === viewerId

  useEffect(() => {
    if (!counts) return
    const controls = animate(start, remaining, {
      duration: 1.1,
      delay: 0.25,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => setFire((n) => n + 1),
    })
    return () => controls.stop()
  }, [counts, start, remaining])

  const left = formatMoney(remaining, groupCurrency)
  const paid = formatMoney(done.paid, done.currency)
  const title = !settled
    ? t('settle.partialTitle')
    : youPaid
      ? t('settle.settledTitle', { name: to })
      : youGot
        ? t('settle.settledTitle', { name: from })
        : t('settle.settledBetween', { from, to })
  const line = settled
    ? t('settle.recorded')
    : !sameCurrency
      ? youPaid
        ? t('settle.youPaid', { name: to, amount: paid })
        : youGot
          ? t('settle.paidYou', { name: from, amount: paid })
          : t('settle.paid', { from, to, amount: paid })
      : youPaid
        ? t('settle.stillOwe', { amount: left })
        : youGot
          ? t('settle.stillOwesYou', { name: from, amount: left })
          : t('settle.stillOwes', { from, to, amount: left })

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
            (settled && shown !== 0 ? 'text-tomato-ink' : 'text-olive-ink')
          }
        >
          {settled
            ? formatMoney(shown, groupCurrency, { locale: intlLocale() })
            : formatMoney(done.paid, done.currency, { locale: intlLocale() })}
        </p>
        <h2 className="font-display text-3xl leading-tight">{title}</h2>
        <p className="text-[0.9375rem] text-mute">{line}</p>
        <span className="sr-only">
          {youPaid
            ? t('settle.youPaid', { name: to, amount: paid })
            : youGot
              ? t('settle.paidYou', { name: from, amount: paid })
              : t('settle.paid', { from, to, amount: paid })}
        </span>
      </div>
      <Button size="lg" variant="ink" onClick={onFinish}>
        {t('settle.backToGroup', { group: groupName })}
      </Button>
    </div>
  )
}
