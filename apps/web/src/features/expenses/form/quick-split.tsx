import type { MoneyMember } from '@potluck/api'
import { firstName } from '@potluck/core'
import { t } from '@potluck/i18n'
import { cn } from '@potluck/ui'
import type { PayersDraft } from './payers-state'
import type { SplitDraft } from './split-state'

interface Choice {
  key: string
  label: string
  paidBy: string
  owers: string[]
}

/**
 * The four one-tap options Splitwise offers when two people share a tab: who paid, and whether
 * it is split equally or owed in full. Each sets the payer and an equal split between the people
 * who owe; anything else is one tap away in the full editor.
 */
export function QuickSplit({
  members,
  viewerId,
  payers,
  draft,
  onPick,
}: {
  members: MoneyMember[]
  viewerId: string
  payers: PayersDraft
  draft: SplitDraft
  onPick: (payers: PayersDraft, draft: SplitDraft) => void
}) {
  const me = members.find((m) => m.id === viewerId) ?? members[0]
  const other = members.find((m) => m.id !== me?.id)
  if (members.length !== 2 || !me || !other) return null
  const name = firstName(other.display_name)
  const choices: Choice[] = [
    {
      key: 'me-equal',
      label: t('expenses.quick.youPaidEqual'),
      paidBy: me.id,
      owers: [me.id, other.id],
    },
    {
      key: 'me-full',
      label: t('expenses.quick.theyOweAll', { name }),
      paidBy: me.id,
      owers: [other.id],
    },
    {
      key: 'other-equal',
      label: t('expenses.quick.theyPaidEqual', { name }),
      paidBy: other.id,
      owers: [me.id, other.id],
    },
    {
      key: 'other-full',
      label: t('expenses.quick.youOweAll', { name }),
      paidBy: other.id,
      owers: [me.id],
    },
  ]
  const order = members.map((m) => m.id)
  const active = (c: Choice) =>
    payers.mode === 'single' &&
    payers.paidBy === c.paidBy &&
    draft.mode === 'equal' &&
    draft.participants.length === c.owers.length &&
    c.owers.every((id) => draft.participants.includes(id))

  return (
    <div role="group" aria-label={t('expenses.quick.label')} className="grid grid-cols-2 gap-2">
      {choices.map((c) => {
        const on = active(c)
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onPick(
                { mode: 'single', paidBy: c.paidBy },
                {
                  ...draft,
                  mode: 'equal',
                  participants: order.filter((id) => c.owers.includes(id)),
                },
              )
            }
            className={cn(
              'min-h-12 rounded-card border px-3 py-2 text-left text-sm leading-snug font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98]',
              on
                ? 'border-ink bg-ink text-paper'
                : 'border-line-strong bg-card text-ink hover:border-ink/40',
            )}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}
