import { moneyQueries, type Debt, type MoneyGroup } from '@potluck/api'
import { pairwiseDebts } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { Avatar, Button, Card, EmptyState, Skeleton, cn } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { Money } from '@/features/expenses/money'
import {
  avatarUrl,
  useGroupExpenses,
  useGroupMoneyRealtime,
  useGroupSettlements,
  useMoneyGroup,
  useNameOf,
  usePeople,
} from '@/features/expenses/money-data'

/** Debts to show: the server's simplified set, or every pair when the group keeps them apart. */
function useDebts(groupId: string, group: MoneyGroup | undefined) {
  const simplify = group?.simplify_debts ?? true
  const simplified = useQuery({
    ...moneyQueries.simplified(supabase, groupId),
    enabled: !!group && simplify,
  })
  const expenses = useGroupExpenses(groupId)
  const settlements = useGroupSettlements(groupId)
  const pairwise = useMemo(() => {
    if (!group || simplify || !expenses.data || !settlements.data) return undefined
    return pairwiseDebts(
      expenses.data.map((e) => ({
        paidBy: e.paid_by,
        amountCents: e.amount_cents,
        currency: e.currency,
        fxRate: e.fx_rate,
        splits: e.expense_splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
      })),
      settlements.data.map((s) => ({
        fromUser: s.from_user,
        toUser: s.to_user,
        amountCents: s.amount_cents,
        currency: s.currency,
        fxRate: s.fx_rate,
      })),
      { groupCurrency: group.currency },
    ).map<Debt>((d) => ({ from_user: d.fromUser, to_user: d.toUser, amount_cents: d.amountCents }))
  }, [group, simplify, expenses.data, settlements.data])
  return simplify ? simplified.data : pairwise
}

export function BalancesTab({ groupId }: { groupId: string }) {
  useGroupMoneyRealtime(groupId)
  const me = useUserId()
  const nameOf = useNameOf()
  const people = usePeople()
  const group = useMoneyGroup(groupId)
  const balances = useQuery(moneyQueries.balances(supabase, groupId))
  const debts = useDebts(groupId, group.data)

  if (!group.data || !balances.data || !debts) return <BalancesSkeleton />

  const currency = group.data.currency
  const net = new Map(balances.data.map((b) => [b.user_id, b.net_cents]))
  const mine = net.get(me) ?? 0
  const everyoneSquare = balances.data.every((b) => b.net_cents === 0)
  const rows = [...group.data.members.map((m) => m.id), ...balances.data.map((b) => b.user_id)]
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => ({ id, cents: net.get(id) ?? 0 }))
    .sort((a, b) => b.cents - a.cents)
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.cents)))
  const myDebts = debts.filter((d) => d.from_user === me)
  const personOf = (id: string) => people.get(id) ?? group.data!.members.find((m) => m.id === id)

  return (
    <div className="flex flex-col gap-6">
      <Card tone="hero" padding="roomy" className="relative overflow-hidden">
        <p className="text-sm font-semibold text-hero-mute">
          {mine > 0
            ? t('balances.youAreOwedTotal')
            : mine < 0
              ? t('balances.youOweTotal')
              : t('balances.youAreSquare')}
        </p>
        <p className="mt-1 text-[3rem] leading-none font-extrabold tracking-tight">
          <Money
            cents={Math.abs(mine)}
            currency={currency}
            surface="hero"
            tone={mine > 0 ? 'owed' : mine < 0 ? 'owe' : 'settled'}
            countUp
            split
          />
        </p>
        {myDebts.length > 0 && (
          <Button asChild className="mt-5">
            <Link
              to="/new/settle"
              search={
                myDebts.length === 1
                  ? { groupId, to: myDebts[0]!.to_user, amount: myDebts[0]!.amount_cents }
                  : { groupId }
              }
            >
              {t('balances.settleUp')}
            </Link>
          </Button>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 -right-4 rotate-12 text-[7rem] leading-none opacity-15 select-none"
        >
          {mine < 0 ? '🧾' : mine > 0 ? '🪙' : '🤝'}
        </span>
      </Card>

      {everyoneSquare ? (
        <EmptyState
          illustration="🤝"
          title={t('empty.balances.title')}
          description={t('empty.balances.body')}
          action={
            <Button asChild variant="secondary" leadingIcon={<Plus />}>
              <Link to="/new/expense" search={{ groupId }}>
                {t('empty.balances.action')}
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="debts-title" className="flex flex-col gap-3">
            <div>
              <h2 id="debts-title" className="font-display text-2xl">
                {group.data.simplify_debts ? t('balances.debts') : t('balances.everyDebt')}
              </h2>
              <p className="text-sm text-mute">
                {group.data.simplify_debts
                  ? t('balances.simplifiedHint')
                  : t('balances.everyDebtHint')}
              </p>
            </div>
            <Card padding="none" className="overflow-hidden">
              <ul className="divide-y divide-line">
                {debts.map((d) => {
                  const from = personOf(d.from_user)
                  const to = personOf(d.to_user)
                  const amount = formatMoney(d.amount_cents, currency)
                  const text =
                    d.from_user === me
                      ? t('balances.youOwe', { name: nameOf(d.to_user), amount })
                      : d.to_user === me
                        ? t('balances.owesYou', { name: nameOf(d.from_user), amount })
                        : t('balances.owes', {
                            from: nameOf(d.from_user),
                            to: nameOf(d.to_user),
                            amount,
                          })
                  return (
                    <li
                      key={`${d.from_user}-${d.to_user}`}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3',
                        d.from_user === me && 'bg-tomato-soft/40',
                        d.to_user === me && 'bg-saffron-soft/40',
                      )}
                    >
                      <span aria-hidden className="flex shrink-0 items-center">
                        <Avatar
                          name={from?.display_name ?? '?'}
                          seed={d.from_user}
                          src={avatarUrl(from?.avatar_path)}
                          size="sm"
                        />
                        <ArrowRight className="mx-0.5 size-3.5 text-mute" strokeWidth={2.5} />
                        <Avatar
                          name={to?.display_name ?? '?'}
                          seed={d.to_user}
                          src={avatarUrl(to?.avatar_path)}
                          size="sm"
                        />
                      </span>
                      <span className="min-w-0 flex-1 text-[0.9375rem] font-medium">{text}</span>
                      {d.from_user === me && (
                        <Button asChild size="sm" variant="ink">
                          <Link
                            to="/new/settle"
                            search={{ groupId, to: d.to_user, amount: d.amount_cents }}
                          >
                            {t('balances.settleUp')}
                          </Link>
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          </section>

          <section aria-labelledby="members-title" className="flex flex-col gap-3">
            <h2 id="members-title" className="font-display text-2xl">
              {t('balances.members')}
            </h2>
            <Card padding="none" className="overflow-hidden">
              <ul className="divide-y divide-line">
                {rows.map((r) => {
                  const person = personOf(r.id)
                  const width = `${(Math.abs(r.cents) / scale) * 50}%`
                  return (
                    <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={person?.display_name ?? '?'}
                          seed={r.id}
                          src={avatarUrl(person?.avatar_path)}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {nameOf(r.id)}
                        </span>
                        <span className="flex flex-col items-end">
                          <span className="text-xs text-mute">
                            {r.cents > 0
                              ? t('balances.isOwedShort')
                              : r.cents < 0
                                ? t('balances.owesShort')
                                : t('balances.settledShort')}
                          </span>
                          {r.cents !== 0 && (
                            <span className="font-bold">
                              <Money
                                cents={Math.abs(r.cents)}
                                currency={currency}
                                tone={r.cents > 0 ? 'owed' : 'owe'}
                              />
                            </span>
                          )}
                        </span>
                      </div>
                      <div aria-hidden className="relative h-1.5 rounded-pill bg-sunken">
                        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                        <span
                          className={cn(
                            'absolute inset-y-0 rounded-pill transition-[width] duration-500',
                            r.cents >= 0 ? 'left-1/2 bg-saffron' : 'right-1/2 bg-tomato',
                          )}
                          style={{ width }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}

function BalancesSkeleton() {
  return (
    <div aria-busy="true" aria-label={t('balances.loading')} className="flex flex-col gap-6">
      <Skeleton className="h-40" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-48" />
    </div>
  )
}
