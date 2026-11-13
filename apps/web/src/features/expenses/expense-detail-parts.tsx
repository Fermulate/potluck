import { avatarSrc } from '@/lib/queries'
import { moneyQueries, type ExpenseWithSplits, type MoneyPerson } from '@potluck/api'
import { formatMoney, formatRelative, t } from '@potluck/i18n'
import { Avatar, AvatarStack, Card, cn } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Money } from './money'
import { namesOf, payersOf, type NameOf } from './expense-math'
import { describeChanges } from './history'

/** "Paid by Ava", "Paid by you and Ben", "Refund to you", with their faces. */
export function PayersLine({
  expense: e,
  me,
  people,
  nameOf,
}: {
  expense: ExpenseWithSplits
  me: string
  people: Map<string, MoneyPerson>
  nameOf: NameOf
}) {
  const payers = payersOf(e)
  // The viewer first, so the faces read in the same order as the names.
  const ids = [
    ...payers.filter((p) => p.user_id === me),
    ...payers.filter((p) => p.user_id !== me),
  ].map((p) => p.user_id)
  const names = namesOf(ids, me, nameOf, { start: false })
  const text =
    ids.length > 1
      ? e.is_refund
        ? t('expenses.detail.receivedByMany', { names })
        : t('expenses.detail.paidByMany', { names })
      : ids[0] === me
        ? e.is_refund
          ? t('expenses.detail.youReceived')
          : t('expenses.detail.youPaid')
        : e.is_refund
          ? t('expenses.detail.receivedBy', { name: nameOf(ids[0]!) })
          : t('expenses.detail.paidBy', { name: nameOf(ids[0]!) })
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      {ids.length > 1 ? (
        <AvatarStack
          size="sm"
          max={3}
          people={ids.map((id) => ({
            id,
            name: people.get(id)?.display_name ?? nameOf(id),
            src: avatarSrc(people.get(id)?.avatar_path),
          }))}
        />
      ) : (
        <Avatar
          name={people.get(ids[0]!)?.display_name ?? nameOf(ids[0]!)}
          seed={ids[0]!}
          src={avatarSrc(people.get(ids[0]!)?.avatar_path)}
          size="sm"
        />
      )}
      {text}
    </span>
  )
}

/**
 * Everyone on the expense: their share on the right, and underneath what they paid (or got
 * back) and how the share was worked out. Payers who are not in the split are listed too, so
 * the card always adds up to the amount on both sides.
 */
export function SplitCard({
  expense: e,
  me,
  people,
  nameOf,
}: {
  expense: ExpenseWithSplits
  me: string
  people: Map<string, MoneyPerson>
  nameOf: NameOf
}) {
  const paidBy = new Map(payersOf(e).map((p) => [p.user_id, p.paid_cents]))
  const shares = new Map(e.expense_splits.map((s) => [s.user_id, s]))
  // You first, then whoever paid (most first), then everyone else by share.
  const rank = (id: string) => (id === me ? 2 : paidBy.has(id) ? 1 : 0)
  const ids = [...new Set([...shares.keys(), ...paidBy.keys()])].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (paidBy.get(b) ?? 0) - (paidBy.get(a) ?? 0) ||
      (shares.get(b)?.share_cents ?? 0) - (shares.get(a)?.share_cents ?? 0),
  )
  const money = (cents: number) => formatMoney(cents, e.currency)
  const type = t(`splitTypes.${e.split_type}.label`).toLocaleLowerCase()
  const sign = e.is_refund ? -1 : 1
  // The share on the right is coloured only where it is also what you owe (or get back, on a
  // refund): your own line when you did not pay. A payer's share is not their balance, so it
  // stays neutral and their net goes underneath, in its own colour.
  const toneOf = (id: string, paid: number | undefined) =>
    paid !== undefined || id !== me
      ? ('neutral' as const)
      : e.is_refund
        ? ('owed' as const)
        : ('owe' as const)

  return (
    <Card padding="none" className="overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-mute">
        {e.is_refund
          ? t('expenses.detail.splitRefund', { type })
          : t('expenses.detail.split', { type })}
      </h2>
      <ul className="divide-y divide-line">
        {ids.map((id) => {
          const s = shares.get(id)
          const share = s?.share_cents ?? 0
          const paid = paidBy.get(id)
          const isMe = id === me
          const line =
            paid !== undefined
              ? s
                ? t(e.is_refund ? 'expenses.detail.gotAndShare' : 'expenses.detail.paidAndShare', {
                    paid: money(paid),
                    share: money(share),
                  })
                : t(e.is_refund ? 'expenses.detail.gotOnly' : 'expenses.detail.paidOnly', {
                    amount: money(paid),
                  })
              : e.is_refund
                ? t('expenses.detail.getsBack', { amount: money(share) })
                : t('expenses.detail.owes', { amount: money(share) })
          return (
            <li
              key={id}
              className={cn('flex items-center gap-3 px-4 py-3', isMe && 'bg-saffron-soft/50')}
            >
              <Avatar
                name={people.get(id)?.display_name ?? nameOf(id)}
                seed={id}
                src={avatarSrc(people.get(id)?.avatar_path)}
                size="md"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{nameOf(id)}</span>
                <span className="text-sm text-mute">
                  {line}
                  {s && e.split_type === 'percent' && s.weight != null && ` (${s.weight}%)`}
                  {s &&
                    e.split_type === 'shares' &&
                    s.weight != null &&
                    ` (${t('expenses.shareCount', { count: Number(s.weight) })})`}
                  {s &&
                    e.split_type === 'adjustment' &&
                    !!s.adjustment_cents &&
                    ` (${s.adjustment_cents > 0 ? '+' : '−'}${money(Math.abs(s.adjustment_cents))})`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="text-lg font-bold">
                  <Money cents={share} currency={e.currency} tone={toneOf(id, paid)} />
                </span>
                {paid !== undefined && sign * (paid - share) !== 0 && (
                  <span
                    className={cn(
                      'text-xs font-semibold',
                      sign * (paid - share) > 0 ? 'text-saffron-ink' : 'text-tomato-ink',
                    )}
                  >
                    {sign * (paid - share) > 0
                      ? t('expenses.detail.getsBack', { amount: money(sign * (paid - share)) })
                      : t('expenses.detail.owes', { amount: money(-sign * (paid - share)) })}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** The bill as it was entered: items, who had each, then tax, tip and discount. */
export function ItemsCard({
  expense: e,
  me,
  nameOf,
}: {
  expense: ExpenseWithSplits
  me: string
  nameOf: NameOf
}) {
  if (e.expense_items.length === 0) return null
  const items = [...e.expense_items].sort((a, b) => a.position - b.position)
  const extras = [
    { key: 'tax', label: t('expenses.itemized.tax'), cents: e.tax_cents ?? 0 },
    { key: 'tip', label: t('expenses.itemized.tip'), cents: e.tip_cents ?? 0 },
    { key: 'discount', label: t('expenses.itemized.discount'), cents: -(e.discount_cents ?? 0) },
  ].filter((x) => x.cents !== 0)
  return (
    <section aria-labelledby="items-title" className="flex flex-col gap-3">
      <h2 id="items-title" className="font-display text-2xl">
        {t('expenses.detail.items')}
      </h2>
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-line">
          {items.map((item, index) => (
            <li key={item.position} className="flex items-start gap-3 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">
                  {item.description || t('expenses.itemizedEditor.untitled', { number: index + 1 })}
                </span>
                <span className="text-sm text-mute">
                  {t('expenses.detail.itemPeople', {
                    names: namesOf(item.user_ids, me, nameOf, { start: false, max: 3 }),
                  })}
                </span>
              </span>
              <span className="tabular font-semibold">
                <Money cents={item.amount_cents} currency={e.currency} tone="neutral" />
              </span>
            </li>
          ))}
        </ul>
        {extras.length > 0 && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-line bg-sunken px-4 py-3 text-sm">
            {extras.map((x) => (
              <div key={x.key} className="contents">
                <dt className="text-mute">{x.label}</dt>
                <dd className="text-right tabular font-semibold">
                  {x.cents < 0 && '−'}
                  <Money cents={Math.abs(x.cents)} currency={e.currency} tone="neutral" />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </section>
  )
}

const HISTORY_VERBS = ['created', 'updated', 'deleted', 'restored'] as const
type HistoryVerb = (typeof HISTORY_VERBS)[number]

/**
 * Who added the expense and every later change, oldest first, from the activity log. Each edit
 * lists the fields it changed with their old and new values; edits logged before those were
 * kept fall back to the amount change, when there was one.
 */
export function ExpenseHistory({
  expense: e,
  me,
  timeZone,
  nameOf,
}: {
  expense: ExpenseWithSplits
  me: string
  timeZone: string
  nameOf: NameOf
}) {
  const history = useQuery(moneyQueries.history(supabase, e.id))
  const entries = (history.data ?? []).filter((h) =>
    HISTORY_VERBS.includes(h.verb.replace('expense.', '') as HistoryVerb),
  )
  if (entries.length === 0) {
    return e.created_by ? (
      <p className="text-sm text-mute">
        {e.created_by === me
          ? t('expenses.createdByYou', { when: formatRelative(e.created_at, { timeZone }) })
          : t('expenses.createdBy', {
              name: nameOf(e.created_by),
              when: formatRelative(e.created_at, { timeZone }),
            })}
      </p>
    ) : null
  }
  const amounts = entries.map((entry) => {
    const cents = typeof entry.data.amount_cents === 'number' ? entry.data.amount_cents : null
    const currency = typeof entry.data.currency === 'string' ? entry.data.currency : null
    return cents !== null && currency ? formatMoney(cents, currency) : null
  })
  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-2">
      <h2 id="history-title" className="text-sm font-bold text-mute">
        {t('expenses.history.title')}
      </h2>
      <ol className="relative flex flex-col gap-3 border-l-2 border-line pl-4">
        {entries.map((entry, index) => {
          const verb = entry.verb.replace('expense.', '') as HistoryVerb
          const lines =
            verb === 'updated' ? describeChanges(entry.data, { viewerId: me, nameOf }) : []
          const amount = amounts[index]
          const from = amounts.slice(0, index).findLast((a) => a !== null) ?? null
          const legacyAmount =
            verb === 'updated' &&
            lines.length === 0 &&
            !entry.data.changes &&
            from &&
            amount &&
            from !== amount
          return (
            <li key={entry.id} className="relative text-sm">
              <span
                aria-hidden
                className={cn(
                  'absolute top-1.5 -left-[1.3125rem] size-2.5 rounded-full ring-2 ring-paper',
                  verb === 'deleted' ? 'bg-tomato' : verb === 'created' ? 'bg-olive' : 'bg-saffron',
                )}
              />
              <span className="font-semibold text-ink">
                {entry.actor_id === me
                  ? t(`expenses.history.self.${verb}`)
                  : t(`expenses.history.${verb}`, { name: nameOf(entry.actor_id ?? '') })}
              </span>
              {legacyAmount && (
                <span className="text-mute">
                  {' '}
                  ({t('expenses.history.amountChanged', { from: from!, to: amount })})
                </span>
              )}
              <span className="block text-mute">
                <time dateTime={entry.created_at}>
                  {formatRelative(entry.created_at, { timeZone })}
                </time>
              </span>
              {lines.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-ink/80">
                  {lines.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
