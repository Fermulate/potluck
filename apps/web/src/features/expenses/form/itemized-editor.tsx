import type { MoneyMember } from '@potluck/api'
import type { Shares } from '@potluck/core'
import { t } from '@potluck/i18n'
import { Avatar, Button, IconButton, cn } from '@potluck/ui'
import { Money } from '../money'
import { Plus, X } from 'lucide-react'
import { avatarUrl, firstName } from '../money-data'
import { CompactMoneyInput } from './compact-inputs'
import {
  TIP_PERCENTS,
  itemsTotal,
  newItem,
  tipFor,
  type ItemDraft,
  type SplitDraft,
} from './split-state'

/**
 * Line items, each shared equally by the people who had it. Tax and tip are spread in
 * proportion to everyone's subtotal (core `splitItemized`), and the total drives the amount.
 */
export function ItemizedEditor({
  members,
  viewerId,
  draft,
  onChange,
  currency,
  shares,
}: {
  members: MoneyMember[]
  viewerId: string
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  currency: string
  shares: Shares | null
}) {
  const name = (m: MoneyMember) => (m.id === viewerId ? t('common.you') : firstName(m.display_name))
  const update = (id: string, patch: Partial<ItemDraft>) =>
    onChange({
      ...draft,
      items: draft.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  const subtotal = draft.items.reduce((a, i) => a + (i.amountCents ?? 0), 0)
  // You first, so your own chip is always in the same spot.
  const chips = [...members].sort((a, b) => Number(b.id === viewerId) - Number(a.id === viewerId))

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-3">
        {draft.items.map((item, index) => {
          const label =
            item.name.trim() || t('expenses.itemizedEditor.untitled', { number: index + 1 })
          return (
            <li key={item.id} className="rounded-card border border-line bg-paper/60 p-3">
              <div className="flex items-center gap-2">
                <input
                  value={item.name}
                  onChange={(e) => update(item.id, { name: e.target.value })}
                  placeholder={t('expenses.itemizedEditor.itemPlaceholder')}
                  aria-label={t('expenses.itemized.itemName')}
                  maxLength={80}
                  className="h-11 min-w-0 flex-1 rounded-input border border-line-strong bg-card px-3 text-base font-semibold text-ink placeholder:font-normal placeholder:text-mute/70 focus:border-ink focus-visible:outline-none"
                />
                <CompactMoneyInput
                  currency={currency}
                  value={item.amountCents}
                  onValueChange={(amountCents) => update(item.id, { amountCents })}
                  aria-label={`${t('expenses.itemized.itemAmount')}, ${label}`}
                  className="w-28"
                />
                {draft.items.length > 1 && (
                  <IconButton
                    size="sm"
                    label={t('expenses.itemizedEditor.remove', { item: label })}
                    icon={<X />}
                    onClick={() =>
                      onChange({ ...draft, items: draft.items.filter((i) => i.id !== item.id) })
                    }
                  />
                )}
              </div>
              <div
                role="group"
                aria-label={t('expenses.itemizedEditor.assign', { item: label })}
                className="mt-2.5 flex flex-wrap gap-1.5"
              >
                {chips.map((m) => {
                  const on = item.userIds.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        update(item.id, {
                          userIds: on
                            ? item.userIds.filter((u) => u !== m.id)
                            : members
                                .map((x) => x.id)
                                .filter((u) => u === m.id || item.userIds.includes(u)),
                        })
                      }
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-pill border pr-2.5 pl-0.5 text-xs font-semibold transition-colors',
                        on
                          ? 'border-ink bg-ink text-paper'
                          : 'border-dashed border-line-strong text-mute hover:text-ink',
                      )}
                    >
                      <Avatar
                        name={m.display_name}
                        seed={m.id}
                        src={avatarUrl(m.avatar_path)}
                        size="xs"
                        className={cn(on ? 'ring-1 ring-paper/60' : 'opacity-50')}
                      />
                      {name(m)}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Plus />}
        className="self-start"
        onClick={() =>
          onChange({ ...draft, items: [...draft.items, newItem(members.map((m) => m.id))] })
        }
      >
        {t('expenses.itemized.addItem')}
      </Button>

      <dl className="grid grid-cols-[1fr_auto] items-center gap-y-2 rounded-card bg-sunken p-4">
        <dt className="text-sm text-mute">{t('expenses.itemized.subtotal')}</dt>
        <dd className="text-right tabular font-semibold">
          <Money cents={subtotal} currency={currency} tone="neutral" />
        </dd>
        <dt>
          <label htmlFor="itemized-tax" className="text-sm text-mute">
            {t('expenses.itemized.tax')}
          </label>
        </dt>
        <dd>
          <CompactMoneyInput
            id="itemized-tax"
            currency={currency}
            value={draft.taxCents}
            onValueChange={(taxCents) => onChange({ ...draft, taxCents })}
            className="h-10 w-28"
          />
        </dd>
        <dt className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor="itemized-tip" className="text-sm text-mute">
            {t('expenses.itemized.tip')}
          </label>
          {subtotal > 0 && (
            <span className="flex gap-1">
              {TIP_PERCENTS.map((percent) => {
                const cents = tipFor(subtotal, percent)
                const on = draft.tipCents === cents
                return (
                  <button
                    key={percent}
                    type="button"
                    aria-pressed={on}
                    aria-label={t('expenses.itemizedEditor.tipPercentLabel', { percent })}
                    onClick={() => onChange({ ...draft, tipCents: on ? null : cents })}
                    className={cn(
                      'h-7 rounded-pill border px-2 text-xs font-semibold tabular transition-colors',
                      on
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line-strong bg-card text-ink hover:border-ink/40',
                    )}
                  >
                    {t('expenses.itemizedEditor.tipPercent', { percent })}
                  </button>
                )
              })}
            </span>
          )}
        </dt>
        <dd>
          <CompactMoneyInput
            id="itemized-tip"
            currency={currency}
            value={draft.tipCents}
            onValueChange={(tipCents) => onChange({ ...draft, tipCents })}
            className="h-10 w-28"
          />
        </dd>
        <dt className="border-t border-line-strong pt-2 font-bold">
          {t('expenses.itemized.total')}
        </dt>
        <dd className="border-t border-line-strong pt-2 text-right tabular text-lg font-extrabold">
          <Money cents={itemsTotal(draft)} currency={currency} tone="neutral" />
        </dd>
      </dl>

      {shares && (
        <ul className="divide-y divide-line">
          {members
            .filter((m) => (shares[m.id] ?? 0) > 0)
            .map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <Avatar
                  name={m.display_name}
                  seed={m.id}
                  src={avatarUrl(m.avatar_path)}
                  size="sm"
                />
                <span className="flex-1 truncate font-semibold">{name(m)}</span>
                <span className="tabular font-bold">
                  <Money cents={shares[m.id] ?? 0} currency={currency} tone="neutral" />
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
