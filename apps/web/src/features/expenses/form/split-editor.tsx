import type { MoneyMember, SplitTypeValue } from '@potluck/api'
import { SPLIT_TYPES, type SplitResult } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Avatar, Button, IconButton, SegmentedControl, cn } from '@potluck/ui'
import { Money } from '../money'
import { Check, Equal, Layers, Minus, PencilLine, Percent, Plus, ReceiptText } from 'lucide-react'
import type { ReactNode } from 'react'
import { avatarUrl, firstName } from '../money-data'
import { CompactMoneyInput, PercentInput } from './compact-inputs'
import { ItemizedEditor } from './itemized-editor'
import { PercentSlider } from './percent-slider'
import {
  FULL,
  evenPercent,
  previewSplit,
  setPercent,
  toggleParticipant,
  type SplitDraft,
} from './split-state'

const MODE_ICONS: Record<SplitTypeValue, ReactNode> = {
  equal: <Equal />,
  exact: <PencilLine />,
  percent: <Percent />,
  shares: <Layers />,
  itemized: <ReceiptText />,
}

export interface SplitEditorProps {
  members: MoneyMember[]
  viewerId: string
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  amountCents: number
  currency: string
}

function displayName(member: MoneyMember, viewerId: string) {
  return member.id === viewerId ? t('common.you') : firstName(member.display_name)
}

export function splitErrorText(result: SplitResult): string | null {
  if (result.ok) return null
  return t(`errors.split.${result.error.code}`)
}

export function SplitEditor({
  members,
  viewerId,
  draft,
  onChange,
  amountCents,
  currency,
}: SplitEditorProps) {
  const order = members.map((m) => m.id)
  const byId = new Map(members.map((m) => [m.id, m]))
  const result = previewSplit(draft, amountCents)
  const shares = result.ok ? result.shares : null
  const participants = draft.participants
    .map((id) => byId.get(id))
    .filter((m): m is MoneyMember => !!m)

  const money = (cents: number) => formatMoney(cents, currency)

  const shareCell = (id: string) => (
    <span className="w-20 shrink-0 text-right tabular text-[0.9375rem] font-bold">
      {shares ? (
        <Money cents={shares[id] ?? 0} currency={currency} tone="neutral" />
      ) : (
        <span className="text-mute">...</span>
      )}
    </span>
  )

  const personCell = (member: MoneyMember) => (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <Avatar
        name={member.display_name}
        seed={member.id}
        src={avatarUrl(member.avatar_path)}
        size="sm"
      />
      <span className="truncate font-semibold">{displayName(member, viewerId)}</span>
    </span>
  )

  let body: ReactNode = null
  let status: ReactNode = null

  if (draft.mode === 'equal') {
    body = participants.map((m) => (
      <li key={m.id} className="flex items-center gap-3 py-2">
        {personCell(m)}
        {shareCell(m.id)}
      </li>
    ))
    if (shares && participants.length > 0) {
      status = (
        <StatusPill tone="ok">
          {t('expenses.perPerson', {
            amount: money(Math.floor(amountCents / participants.length)),
          })}
        </StatusPill>
      )
    }
  } else if (draft.mode === 'exact') {
    const assigned = participants.reduce((a, m) => a + (draft.exact[m.id] ?? 0), 0)
    const left = amountCents - assigned
    body = participants.map((m) => (
      <li key={m.id} className="flex items-center gap-3 py-1.5">
        {personCell(m)}
        <CompactMoneyInput
          currency={currency}
          value={draft.exact[m.id] ?? null}
          onValueChange={(cents) =>
            onChange({ ...draft, exact: { ...draft.exact, [m.id]: cents } })
          }
          aria-label={t('expenses.splitEditor.amountOf', { name: displayName(m, viewerId) })}
          className="w-32"
        />
      </li>
    ))
    status = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={left === 0 ? 'ok' : left > 0 ? 'left' : 'over'}>
          {left === 0
            ? t('expenses.allAssigned')
            : left > 0
              ? t('expenses.remaining', { amount: money(left) })
              : t('expenses.overBy', { amount: money(-left) })}
        </StatusPill>
        {left !== 0 && participants.length > 0 && amountCents > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const even = previewSplit({ ...draft, mode: 'equal' }, amountCents)
              if (even.ok) onChange({ ...draft, exact: even.shares })
            }}
          >
            {t('expenses.splitEditor.evenOut')}
          </Button>
        )}
      </div>
    )
  } else if (draft.mode === 'percent') {
    body = participants.map((m) => (
      <li key={m.id} className="flex items-center gap-3 py-1.5">
        {personCell(m)}
        <PercentInput
          basisPoints={draft.percent[m.id] ?? 0}
          onCommit={(bp) =>
            onChange({ ...draft, percent: setPercent(draft.percent, draft.participants, m.id, bp) })
          }
          aria-label={t('expenses.splitEditor.percentOf', { name: displayName(m, viewerId) })}
          className="w-24"
        />
        {shareCell(m.id)}
      </li>
    ))
    const total = participants.reduce((a, m) => a + (draft.percent[m.id] ?? 0), 0)
    status = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={total === FULL ? 'ok' : 'over'}>{`${total / 100}% / 100%`}</StatusPill>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...draft, percent: evenPercent(draft.participants) })}
        >
          {t('expenses.splitEditor.evenOut')}
        </Button>
      </div>
    )
  } else if (draft.mode === 'shares') {
    body = participants.map((m) => {
      const count = draft.shares[m.id] ?? 0
      const name = displayName(m, viewerId)
      const set = (n: number) =>
        onChange({ ...draft, shares: { ...draft.shares, [m.id]: Math.max(0, Math.min(99, n)) } })
      return (
        <li key={m.id} className="flex items-center gap-3 py-1.5">
          {personCell(m)}
          <span className="flex shrink-0 items-center gap-1 rounded-pill border border-line-strong bg-card p-0.5">
            <IconButton
              size="sm"
              label={t('expenses.splitEditor.fewer', { name })}
              icon={<Minus />}
              onClick={() => set(count - 1)}
              disabled={count <= 0}
            />
            <output
              aria-label={t('expenses.splitEditor.sharesOf', { name })}
              aria-live="polite"
              className="w-6 text-center tabular text-base font-bold"
            >
              {count}
            </output>
            <IconButton
              size="sm"
              label={t('expenses.splitEditor.more', { name })}
              icon={<Plus />}
              onClick={() => set(count + 1)}
              disabled={count >= 99}
            />
          </span>
          {shareCell(m.id)}
        </li>
      )
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 [scrollbar-width:none] overflow-x-auto px-1 pb-1">
        <SegmentedControl
          label={t('splitTypes.label')}
          value={draft.mode}
          onValueChange={(mode) => onChange({ ...draft, mode })}
          options={SPLIT_TYPES.map((mode) => ({
            value: mode,
            label: t(`splitTypes.${mode}.label`),
            icon: MODE_ICONS[mode],
          }))}
          size="sm"
        />
      </div>
      <p className="-mt-2 text-sm text-mute">{t(`splitTypes.${draft.mode}.hint`)}</p>

      {draft.mode === 'itemized' ? (
        <ItemizedEditor
          members={members}
          viewerId={viewerId}
          draft={draft}
          onChange={onChange}
          currency={currency}
          shares={shares}
        />
      ) : (
        <>
          <div
            role="group"
            aria-label={t('expenses.fields.splitBetween')}
            className="flex flex-wrap gap-2"
          >
            {members.map((m) => {
              const on = draft.participants.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(toggleParticipant(draft, m.id, order))}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-pill border pr-3.5 pl-1 text-sm font-semibold transition-[background-color,border-color,color,opacity] duration-150 active:scale-[0.97]',
                    on
                      ? 'border-ink bg-ink text-paper'
                      : 'border-dashed border-line-strong bg-transparent text-mute hover:text-ink',
                  )}
                >
                  <span className="relative">
                    <Avatar
                      name={m.display_name}
                      seed={m.id}
                      src={avatarUrl(m.avatar_path)}
                      size="sm"
                      className={cn(!on && 'opacity-50 grayscale')}
                    />
                    {on && (
                      <span
                        aria-hidden
                        className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-olive text-on-olive ring-2 ring-ink"
                      >
                        <Check className="size-2.5" strokeWidth={4} />
                      </span>
                    )}
                  </span>
                  {displayName(m, viewerId)}
                </button>
              )
            })}
          </div>

          {participants.length === 0 ? (
            <p className="text-sm font-medium text-tomato-ink">
              {t('expenses.splitEditor.nobody')}
            </p>
          ) : (
            <>
              {draft.mode === 'percent' && participants.length > 1 && (
                <PercentSlider
                  people={participants.map((m) => ({
                    id: m.id,
                    name: displayName(m, viewerId),
                    avatarSrc: avatarUrl(m.avatar_path),
                  }))}
                  percent={draft.percent}
                  onChange={(percent) => onChange({ ...draft, percent })}
                />
              )}
              <ul className="divide-y divide-line">{body}</ul>
            </>
          )}
          {status}
        </>
      )}
    </div>
  )
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'left' | 'over'
  children: ReactNode
}) {
  return (
    <p
      role="status"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-pill px-3 tabular text-sm font-semibold',
        tone === 'ok' && 'bg-olive-soft text-olive-ink',
        tone === 'left' && 'bg-saffron-soft text-saffron-ink',
        tone === 'over' && 'bg-tomato-soft text-tomato-ink',
      )}
    >
      {tone === 'ok' && <Check aria-hidden className="size-4" strokeWidth={3} />}
      {children}
    </p>
  )
}
