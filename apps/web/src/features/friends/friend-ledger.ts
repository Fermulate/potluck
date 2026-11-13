import {
  moneyQueries,
  type ExpenseWithSplits,
  type GroupDetail,
  type Settlement,
} from '@potluck/api'
import type { BalanceSettlement } from '@potluck/core'
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'

export interface Ledger {
  expenses: ExpenseWithSplits[]
  settlements: Settlement[]
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
