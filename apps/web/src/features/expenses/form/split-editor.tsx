import { avatarSrc } from '@/lib/queries'
import type { MoneyMember, SplitTypeValue } from '@potluck/api'
import { firstName, SPLIT_TYPES } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Avatar, Button, IconButton, SegmentedControl, cn } from '@potluck/ui'
import { Money } from '../money'
import {
  Check,
  Diff,
  Equal,
  Layers,
  Minus,
  PencilLine,
  Percent,
  Plus,
  ReceiptText,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { SPLIT_HELP } from '@/features/help/topics'
import { joinNames } from '@/features/plans/format'
import { CompactMoneyInput, PercentInput, SignedMoneyInput } from './compact-inputs'
import { ItemizedEditor } from './itemized-editor'
import { PercentSlider } from './percent-slider'
import {
  evenPercent,
  formatPercent,
  percentLeft,
  previewSplit,
  roundingExtras,
  splitErrorText,
  toggleParticipant,
  typePercent,
  viewerFirst,
  type SplitDraft,
} from './split-state'

const MODE_ICONS: Record<SplitTypeValue, ReactNode> = {
  equal: <Equal />,
  exact: <PencilLine />,
  percent: <Percent />,
  shares: <Layers />,
  adjustment: <Diff />,
  itemized: <ReceiptText />,
}

export interface SplitEditorProps {
  members: MoneyMember[]
  viewerId: string
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  amountCents: number
  currency: string
  /** How amounts and percents are typed, the same as the main amount field. */
  locale: string
  /** Which split types to offer (all of them by default). */
  modes?: readonly SplitTypeValue[]
  /** Show each person's amount; off when there is no amount yet (the group's default split). */
  showAmounts?: boolean
  /** Offers to add someone not on Potluck yet; the form puts them in the split once added. */
  onAddPerson?: () => void
}

function displayName(member: MoneyMember, viewerId: string) {
  return member.id === viewerId ? t('common.you') : firstName(member.display_name)
}

export function SplitEditor({
  members,
  viewerId,
  draft,
  onChange,
  amountCents,
  currency,
  locale,
  modes = SPLIT_TYPES,
  showAmounts = true,
  onAddPerson,
}: SplitEditorProps) {
  const order = members.map((m) => m.id)
  const modesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Sideways only: scrollIntoView could also move the page.
    const track = modesRef.current
    const chosen = track?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!track || !chosen) return
    const left =
      chosen.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft
    if (left < track.scrollLeft) track.scrollLeft = left
    else if (left + chosen.offsetWidth > track.scrollLeft + track.clientWidth) {
      track.scrollLeft = left + chosen.offsetWidth - track.clientWidth
    }
  }, [draft.mode])
  const byId = new Map(members.map((m) => [m.id, m]))
  const result = previewSplit(draft, amountCents)
  const shares = result.ok ? result.shares : null
  // Chips, rows and the slider all list people the same way, in every split type.
  const shown = viewerFirst(members, viewerId)
  const participants = shown.filter((m) => draft.participants.includes(m.id))

  const money = (cents: number) => formatMoney(cents, currency)
  const extras = amountCents > 0 ? roundingExtras(draft, result) : []
  const roundingNote =
    showAmounts && extras.length > 0 ? (
      <p className="flex items-start justify-between gap-3 text-xs text-mute">
        <span>
          {t(extras.length === 1 ? 'help.rounding.one' : 'help.rounding.each', {
            amount: money(1),
            names: joinNames(
              extras.map((id) => {
                const member = byId.get(id)
                if (id === viewerId) return t('help.rounding.you')
                return member ? firstName(member.display_name) : t('activity.someone')
              }),
              3,
            ),
          })}
        </span>
        <Help topic="rounding" />
      </p>
    ) : null

  const shareCell = (id: string) =>
    showAmounts && (
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
        src={avatarSrc(member.avatar_path)}
        size="sm"
      />
      <span className="truncate font-semibold">{displayName(member, viewerId)}</span>
    </span>
  )

  let body: ReactNode = null
  let status: ReactNode = null

  if (draft.mode === 'equal') {
    // Without amounts the chips already say everything an equal split is.
    body = !showAmounts
      ? null
      : participants.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2">
            {personCell(m)}
            {shareCell(m.id)}
          </li>
        ))
    if (showAmounts && shares && participants.length > 0) {
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
          locale={locale}
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
          locale={locale}
          basisPoints={draft.percent[m.id] ?? 0}
          onValueChange={(bp) =>
            onChange({ ...draft, percent: typePercent(draft.percent, m.id, bp) })
          }
          aria-label={t('expenses.splitEditor.percentOf', { name: displayName(m, viewerId) })}
          className="w-24"
        />
        {shareCell(m.id)}
      </li>
    ))
    const left = percentLeft(draft)
    const percent = formatPercent(Math.abs(left), locale)
    status = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill tone={left === 0 ? 'ok' : left > 0 ? 'left' : 'over'}>
          {left === 0
            ? t('expenses.allAssigned')
            : left > 0
              ? t('expenses.percentRemaining', { percent })
              : t('expenses.percentOver', { percent })}
        </StatusPill>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange({ ...draft, percent: evenPercent(draft.participants) })}
        >
          {t('expenses.splitEditor.evenOut')}
        </Button>
      </div>
    )
  } else if (draft.mode === 'adjustment') {
    body = participants.map((m) => (
      <li key={m.id} className="flex items-center gap-3 py-1.5">
        {personCell(m)}
        <SignedMoneyInput
          currency={currency}
          locale={locale}
          value={draft.adjust[m.id] ?? null}
          onValueChange={(cents) =>
            onChange({ ...draft, adjust: { ...draft.adjust, [m.id]: cents } })
          }
          minusLabel={t('expenses.adjust.minusOf', { name: displayName(m, viewerId) })}
          aria-label={t('expenses.adjust.of', { name: displayName(m, viewerId) })}
          className="w-32"
        />
        {shareCell(m.id)}
      </li>
    ))
    const adjusted = participants.reduce((a, m) => a + (draft.adjust[m.id] ?? 0), 0)
    const rest = amountCents - adjusted
    status =
      amountCents > 0 ? (
        <StatusPill tone={result.ok ? 'ok' : 'over'}>
          {result.ok ? t('expenses.adjust.rest', { amount: money(rest) }) : splitErrorText(result)}
        </StatusPill>
      ) : null
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
      {/* Six modes do not fit every phone: the track scrolls sideways and keeps the chosen mode
          in view. Icons join in only where the split column is wide (one
          column layouts from md, before the two column lg). */}
      <div
        ref={modesRef}
        className="-mx-1 [scrollbar-width:none] overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:hidden"
      >
        <SegmentedControl
          block
          className="w-full min-w-max [&>button]:px-2.5"
          label={t('splitTypes.label')}
          value={draft.mode}
          onValueChange={(mode) => onChange({ ...draft, mode })}
          options={modes.map((mode) => ({
            value: mode,
            label: (
              <>
                <span aria-hidden className="hidden md:inline-flex lg:hidden">
                  {MODE_ICONS[mode]}
                </span>
                {t(`splitTypes.${mode}.short`)}
              </>
            ),
          }))}
          size="sm"
        />
      </div>
      <div className="-mt-2 flex items-start justify-between gap-3">
        <p className="text-sm text-mute">{t(`splitTypes.${draft.mode}.hint`)}</p>
        <Help topic={SPLIT_HELP[draft.mode]} className="mt-px" />
      </div>

      {draft.mode === 'itemized' ? (
        <ItemizedEditor
          members={members}
          viewerId={viewerId}
          draft={draft}
          onChange={onChange}
          currency={currency}
          locale={locale}
          shares={shares}
        />
      ) : (
        <>
          <div
            role="group"
            aria-label={t('expenses.fields.splitBetween')}
            className="flex flex-wrap gap-2"
          >
            {shown.map((m) => {
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
                      src={avatarSrc(m.avatar_path)}
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
            {onAddPerson && (
              <button
                type="button"
                onClick={onAddPerson}
                className="inline-flex h-10 items-center gap-1.5 rounded-pill border border-dashed border-line-strong px-3.5 text-sm font-semibold text-mute transition-colors hover:border-ink/40 hover:text-ink"
              >
                <Plus aria-hidden className="size-4" />
                {t('people.placeholder.addToSplit')}
              </button>
            )}
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
                    fullName: m.display_name,
                    avatarSrc: avatarSrc(m.avatar_path),
                  }))}
                  percent={draft.percent}
                  onChange={(percent) => onChange({ ...draft, percent })}
                />
              )}
              {body && <ul className="divide-y divide-line">{body}</ul>}
            </>
          )}
          {status}
        </>
      )}
      {roundingNote}
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
