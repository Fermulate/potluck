import { avatarSrc } from '@/lib/queries'
import {
  createExpense,
  updateExpense,
  uploadReceipt,
  type ExpensePayload,
  type ExpenseWithSplits,
  type MoneyGroup,
  type MoneyMember,
  type RecurrenceValue,
} from '@potluck/api'
import { CATEGORIES, firstName, type CategoryId } from '@potluck/core'
import { DEFAULT_LOCALE, formatMoney, t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Field,
  Input,
  MoneyInput,
  Select,
  Skeleton,
  TextArea,
  cn,
  toast,
} from '@potluck/ui'
import { Help } from '@/features/help/help'
import { joinNames } from '@/features/plans/format'
import { Money } from '../money'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarHeart } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { departedMembers } from '../expense-math'
import { categoryLabel, todayIn } from '../format'
import { groupTitle } from '../format'
import { MoneyPageShell } from '../money-page-shell'
import {
  invalidateMoney,
  moneyErrorMessage,
  useMoneyGroup,
  usePeople,
  useTimeZone,
} from '../money-data'
import { ConversionPreview } from './conversion-preview'
import { CurrencyPicker } from './currency-picker'
import { receiptExtension, receiptType } from './receipt'
import { ReceiptField, type ReceiptValue } from './receipt-field'
import { SplitEditor } from './split-editor'
import {
  draftFromExpense,
  effectiveAmount,
  formerParticipants,
  initialDraft,
  previewSplit,
  sameSplit,
  splitErrorText,
  splitsPayload,
  type SplitDraft,
} from './split-state'

export type ExpenseFormProps =
  | {
      mode: 'create'
      groupId: string
      eventId?: string
      onDone: (expenseId: string) => void
      onClose: () => void
    }
  | {
      mode: 'edit'
      expense: ExpenseWithSplits
      onDone: (expenseId: string) => void
      onClose: () => void
    }

export function ExpenseForm(props: ExpenseFormProps) {
  const groupId = props.mode === 'create' ? props.groupId : props.expense.group_id
  const group = useMoneyGroup(groupId)
  const title = props.mode === 'create' ? t('expenses.form.newTitle') : t('expenses.form.editTitle')

  if (!group.data) {
    return (
      <MoneyPageShell title={title} onClose={props.onClose} width="lg">
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
  return <LoadedExpenseForm {...props} group={group.data} />
}

type Recurrence = RecurrenceValue | 'none'

function LoadedExpenseForm(props: ExpenseFormProps & { group: MoneyGroup }) {
  const { group } = props
  const editing = props.mode === 'edit' ? props.expense : null
  const me = useUserId()
  const timeZone = useTimeZone()
  const queryClient = useQueryClient()
  const formId = useId()
  const memberIds = group.members.map((m) => m.id)
  const people = usePeople()
  // Someone who has left the group can still be in an older expense, as payer or in the split.
  const formerMember = (id: string): MoneyMember => {
    const person = people.get(id)
    return {
      id,
      display_name: person?.display_name ?? t('expenses.form.formerMember'),
      avatar_path: person?.avatar_path ?? null,
      deleted_at: person?.deleted_at ?? null,
      role: 'member',
    }
  }

  const [amount, setAmount] = useState<number | null>(editing?.amount_cents ?? null)
  const [currency, setCurrency] = useState(editing?.currency ?? group.currency)
  const [description, setDescription] = useState(editing?.description ?? '')
  const [category, setCategory] = useState<string | null>(editing?.category ?? null)
  const [paidBy, setPaidBy] = useState(
    editing?.paid_by ?? (memberIds.includes(me) ? me : (memberIds[0] ?? me)),
  )
  const [spentAt, setSpentAt] = useState(editing?.spent_at ?? todayIn(timeZone))
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [receipt, setReceipt] = useState<ReceiptValue>({
    file: null,
    existingPath: editing?.receipt_path ?? null,
  })
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [savedDraft] = useState<SplitDraft>(() =>
    editing ? draftFromExpense(editing, memberIds) : initialDraft(memberIds),
  )
  const [draft, setDraft] = useState<SplitDraft>(savedDraft)
  const [pickingCurrency, setPickingCurrency] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const total = effectiveAmount(draft, amount)
  const preview = previewSplit(draft, total)
  const descriptionError =
    submitted && !description.trim() ? t('expenses.form.descriptionRequired') : undefined
  const amountError = submitted && total <= 0 ? t('expenses.form.amountRequired') : undefined
  // An unchanged split is not resent, so the stored shares (former members' too) stay as they are.
  const keepSplit = !!editing && total === editing.amount_cents && sameSplit(draft, savedDraft)
  const formerInDraft = formerParticipants(draft, memberIds)
  const formerNames = joinNames(
    formerInDraft.map((id) => firstName(formerMember(id).display_name)),
    3,
  )
  const formerError =
    !keepSplit && formerInDraft.length > 0
      ? t('expenses.form.formerInSplit', { names: formerNames })
      : null
  // Someone who left still has money on this expense: only the details can change.
  const locked = !!editing && departedMembers(editing, memberIds).length > 0
  const splitError =
    submitted && total > 0 && !locked ? (splitErrorText(preview) ?? formerError) : null
  const splitMembers = [
    ...group.members,
    ...formerParticipants(savedDraft, memberIds).map(formerMember),
  ]

  const save = useMutation({
    mutationFn: async () => {
      let receiptPath = receipt.existingPath
      if (receipt.file) {
        try {
          receiptPath = await uploadReceipt(supabase, group.id, receipt.file, {
            extension: receiptExtension(receipt.file),
            contentType: receiptType(receipt.file) ?? receipt.file.type,
          })
        } catch {
          throw new Error('receipt_upload_failed')
        }
      }
      const payload: ExpensePayload = {
        description: description.trim(),
        amount_cents: total,
        currency,
        paid_by: paidBy,
        split_type: draft.mode,
        splits: splitsPayload(draft, total),
        category,
        notes: notes.trim() || null,
        spent_at: spentAt,
        receipt_path: receiptPath,
      }
      if (editing && locked) {
        return updateExpense(supabase, editing.id, {
          description: payload.description,
          category: payload.category,
          notes: payload.notes,
          spent_at: payload.spent_at,
          receipt_path: payload.receipt_path,
        })
      }
      if (editing) {
        if (!keepSplit) return updateExpense(supabase, editing.id, payload)
        const { splits: _splits, split_type: _type, ...details } = payload
        return updateExpense(supabase, editing.id, details)
      }
      return createExpense(supabase, {
        ...payload,
        group_id: group.id,
        ...(props.mode === 'create' && props.eventId ? { event_id: props.eventId } : {}),
        ...(recurrence !== 'none' ? { recurrence } : {}),
      })
    },
    onSuccess: (expense) => {
      invalidateMoney(queryClient, group.id, expense.id)
      // Say what was added and what it means for you, not just that something happened.
      const mine = preview.ok ? (preview.shares[me] ?? 0) : 0
      toast.success(
        editing
          ? t('expenses.updated', { description: description.trim() })
          : mine > 0
            ? t('expenses.saved', {
                description: description.trim(),
                share: formatMoney(mine, currency),
              })
            : t('expenses.savedNotIn', {
                description: description.trim(),
                amount: formatMoney(total, currency),
              }),
      )
      props.onDone(expense.id)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error && error.message === 'receipt_upload_failed'
          ? t('expenses.receiptUpload.failed')
          : moneyErrorMessage(error),
      )
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (!description.trim()) return
    if (!locked && (total <= 0 || !preview.ok || formerError)) return
    save.mutate()
  }

  const formerPayer = editing && !memberIds.includes(editing.paid_by) ? editing.paid_by : null
  const payers = formerPayer ? [...group.members, formerMember(formerPayer)] : group.members
  const payerOptions = payers.map((m) => ({
    value: m.id,
    label: m.id === me ? t('common.you') : m.display_name,
    icon: <Avatar name={m.display_name} seed={m.id} src={avatarSrc(m.avatar_path)} size="xs" />,
  }))

  return (
    <MoneyPageShell
      title={props.mode === 'create' ? t('expenses.form.newTitle') : t('expenses.form.editTitle')}
      onClose={props.onClose}
      width="lg"
      aside={
        <span className="hidden max-w-[40%] items-center gap-1.5 truncate rounded-pill bg-sunken px-3 py-1.5 text-sm font-semibold sm:inline-flex">
          <span aria-hidden>{group.emoji ?? '🍽️'}</span>
          {groupTitle(group, me)}
        </span>
      }
      footer={
        <div className="flex items-center justify-end gap-3">
          {submitted && (descriptionError || amountError || splitError) && (
            <p role="alert" className="mr-auto text-sm font-medium text-tomato-ink">
              {descriptionError ?? amountError ?? splitError}
            </p>
          )}
          <Button
            type="submit"
            form={formId}
            size="lg"
            loading={save.isPending}
            className="w-full sm:w-auto"
          >
            {editing ? t('expenses.form.saveChanges') : t('expenses.form.save')}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 px-4 py-6 md:px-8 md:py-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr]"
      >
        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-col items-center gap-3 rounded-card bg-paper px-4 pt-6 pb-5">
            {locked ? (
              <>
                <span className="text-[3.5rem] leading-none font-extrabold tracking-tight">
                  <Money cents={total} currency={currency} tone="neutral" split />
                </span>
                <p className="text-sm text-mute">{t('expenses.fields.amount')}</p>
              </>
            ) : draft.mode === 'itemized' ? (
              <>
                <span className="text-[3.5rem] leading-none font-extrabold tracking-tight">
                  <Money cents={total} currency={currency} tone="neutral" split />
                </span>
                <p className="text-sm text-mute">{t('expenses.form.itemizedTotal')}</p>
              </>
            ) : (
              <Field
                label={t('expenses.fields.amount')}
                hideLabel
                error={amountError}
                className="w-full items-center"
              >
                <MoneyInput
                  locale={DEFAULT_LOCALE}
                  value={amount}
                  onValueChange={setAmount}
                  currency={currency}
                  onCurrencyPress={() => setPickingCurrency(true)}
                  currencyButtonLabel={`${t('expenses.fields.currency')}, ${currency}`}
                  autoFocus={!editing}
                  className="w-full"
                />
              </Field>
            )}
            {total > 0 && (
              <ConversionPreview
                amountCents={total}
                currency={currency}
                groupCurrency={group.currency}
                spentAt={spentAt}
                savedRate={
                  editing && editing.currency === currency ? Number(editing.fx_rate) : undefined
                }
              />
            )}
          </div>

          <Field label={t('expenses.fields.description')} error={descriptionError}>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('expenses.fields.descriptionPlaceholder')}
              maxLength={120}
              autoComplete="off"
              className="text-lg font-semibold"
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-ink">{t('categories.label')}</legend>
            <div
              role="radiogroup"
              aria-label={t('categories.label')}
              className="flex flex-wrap gap-2"
            >
              {CATEGORIES.map((c) => {
                const checked = category === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setCategory(checked ? null : (c.id as CategoryId))}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.96]',
                      checked
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line-strong bg-card text-ink hover:border-ink/40',
                    )}
                  >
                    <span aria-hidden className="text-base leading-none">
                      {c.emoji}
                    </span>
                    {categoryLabel(c.id)}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('expenses.fields.paidBy')}>
              <Select
                value={paidBy}
                onValueChange={setPaidBy}
                options={payerOptions}
                disabled={locked}
              />
            </Field>
            <Field label={t('expenses.fields.date')}>
              <Input
                type="date"
                value={spentAt}
                onChange={(e) => e.target.value && setSpentAt(e.target.value)}
              />
            </Field>
          </div>
          {props.mode === 'create' && props.eventId && (
            <p className="inline-flex items-center gap-2 text-sm font-medium text-plum-ink">
              <CalendarHeart aria-hidden className="size-4" />
              {t('expenses.form.eventLinked')}
            </p>
          )}
        </div>

        <section
          aria-labelledby={`${formId}-split`}
          className="flex flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-l lg:border-line lg:pl-10"
        >
          <h2 id={`${formId}-split`} className="font-display text-2xl leading-tight">
            {t('expenses.fields.splitBetween')}
          </h2>
          {editing?.split_type === 'itemized' && (
            <p className="text-sm text-mute">{t('expenses.form.itemizedEditNote')}</p>
          )}
          {locked && editing ? (
            <>
              <p role="note" className="text-sm font-medium text-saffron-ink">
                {t('expenses.form.departedLocked')}
              </p>
              <ul aria-label={t('expenses.fields.splitBetween')} className="divide-y divide-line">
                {editing.expense_splits.map((s) => {
                  const person =
                    splitMembers.find((m) => m.id === s.user_id) ?? formerMember(s.user_id)
                  return (
                    <li key={s.user_id} className="flex items-center gap-3 py-2">
                      <Avatar
                        name={person.display_name}
                        seed={person.id}
                        src={avatarSrc(person.avatar_path)}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {person.id === me ? t('common.you') : person.display_name}
                      </span>
                      <Money cents={s.share_cents} currency={editing.currency} tone="neutral" />
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <>
              {formerInDraft.length > 0 && (
                <p className="text-sm text-mute">
                  {t('expenses.form.formerNote', { names: formerNames })}
                </p>
              )}
              <SplitEditor
                members={splitMembers}
                viewerId={me}
                draft={draft}
                onChange={setDraft}
                amountCents={total}
                currency={currency}
                locale={DEFAULT_LOCALE}
              />
            </>
          )}
        </section>

        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
          <Field label={t('expenses.fields.notes')} hint={t('common.optional')}>
            <TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('expenses.fields.notesPlaceholder')}
              maxLength={2000}
              rows={2}
            />
          </Field>
          <ReceiptField value={receipt} onChange={setReceipt} />
          {!editing && (
            <Field
              label={t('expenses.fields.recurring')}
              hint={recurrence !== 'none' ? t('expenses.recurring.hint') : undefined}
              aside={<Help topic="recurring" />}
            >
              <Select
                value={recurrence}
                onValueChange={(v) => setRecurrence(v as Recurrence)}
                options={(['none', 'weekly', 'monthly', 'yearly'] as const).map((r) => ({
                  value: r,
                  label: t(`expenses.recurrence.${r}`),
                }))}
              />
            </Field>
          )}
        </div>
      </form>
      <CurrencyPicker
        open={pickingCurrency}
        onOpenChange={setPickingCurrency}
        value={currency}
        groupCurrency={group.currency}
        spentAt={spentAt}
        onSelect={setCurrency}
      />
    </MoneyPageShell>
  )
}
