import {
  moneyQueries,
  type ExpenseWithSplits,
  type GroupDetail,
  type Settlement,
} from '@potluck/api'
import { netBetween, type BalanceSettlement } from '@potluck/core'
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toBalanceExpense } from '@/features/expenses/expense-math'
import { supabase } from '@/lib/supabase'

export interface Ledger {
  expenses: ExpenseWithSplits[]
  settlements: Settlement[]
}

export interface Standing {
  group: GroupDetail
  /** Positive: the friend owes the viewer, in the group currency. */
  net: number
}

export function toBalanceSettlement(s: Settlement): BalanceSettlement {
  return {
    fromUser: s.from_user,
    toUser: s.to_user,
    amountCents: s.amount_cents,
    currency: s.currency,
    fxRate: s.fx_rate,
    deletedAt: s.deleted_at,
  }
}

type Loaded<T> = { data?: T; isPending: boolean }

// Module scope, so TanStack Query can keep the combined result stable between renders.
const combineExpenses = (results: Loaded<ExpenseWithSplits[]>[]) => ({
  pending: results.some((r) => r.isPending),
  data: results.map((r) => r.data ?? []),
})
const combineSettlements = (results: Loaded<Settlement[]>[]) => ({
  pending: results.some((r) => r.isPending),
  data: results.map((r) => r.data ?? []),
})

/** Every expense and payment of `groups`, by group id, once all of them have loaded. */
export function useLedgers(groups: GroupDetail[]) {
  const expenses = useQueries({
    queries: groups.map((g) => moneyQueries.expenses(supabase, g.id)),
    combine: combineExpenses,
  })
  const settlements = useQueries({
    queries: groups.map((g) => moneyQueries.settlements(supabase, g.id)),
    combine: combineSettlements,
  })
  const byGroup = useMemo(() => {
    const map = new Map<string, Ledger>()
    groups.forEach((g, i) => {
      map.set(g.id, {
        expenses: expenses.data[i] ?? [],
        settlements: settlements.data[i] ?? [],
      })
    })
    return map
  }, [groups, expenses.data, settlements.data])
  return { pending: expenses.pending || settlements.pending, byGroup }
}

/**
 * Where the viewer stands with `friendId` in each group they share (pairwise, as the balances tab
 * nets every pair with simplify off). The friends list and the friend page both use this, so
 * they always agree.
 */
export function standingsWith(
  groups: GroupDetail[],
  byGroup: Map<string, Ledger>,
  me: string,
  friendId: string,
): Standing[] {
  return groups
    .filter((g) => g.members.some((m) => m.id === friendId))
    .map((group) => {
      const ledger = byGroup.get(group.id) ?? { expenses: [], settlements: [] }
      return {
        group,
        net: netBetween(
          ledger.expenses.map(toBalanceExpense),
          ledger.settlements.map(toBalanceSettlement),
          me,
          friendId,
          { groupCurrency: group.currency },
        ),
      }
    })
}

/** Net per currency across standings, leaving out the ones that are square. */
export function totals(standings: Standing[]): [string, number][] {
  const sums = new Map<string, number>()
  for (const s of standings) sums.set(s.group.currency, (sums.get(s.group.currency) ?? 0) + s.net)
  return [...sums].filter(([, net]) => net !== 0)
}
