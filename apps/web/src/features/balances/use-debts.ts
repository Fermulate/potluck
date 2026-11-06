import { moneyQueries, type Debt, type MoneyGroup } from '@potluck/api'
import { pairwiseDebts } from '@potluck/core'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Who owes whom in the group currency: the server's simplified set when the group simplifies
 * debts, otherwise every pair netted on its own. Undefined while loading.
 */
export function useDebts(groupId: string, group: MoneyGroup | undefined): Debt[] | undefined {
  const simplify = group?.simplify_debts ?? true
  const simplified = useQuery({
    ...moneyQueries.simplified(supabase, groupId),
    enabled: !!group && simplify,
  })
  // The whole ledger is only needed to net pairs by hand; the server simplifies on its own.
  const expenses = useQuery({ ...moneyQueries.expenses(supabase, groupId), enabled: !simplify })
  const settlements = useQuery({
    ...moneyQueries.settlements(supabase, groupId),
    enabled: !simplify,
  })
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
