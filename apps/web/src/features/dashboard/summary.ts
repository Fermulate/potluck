import type { HomeBalance } from '@potluck/api'

export interface BalanceSummary {
  currency: string
  /** Net across groups in `currency`. Positive: the viewer is owed. */
  net: number
  /** Total the viewer owes (negative or zero). */
  owe: number
  /** Total owed to the viewer (positive or zero). */
  owed: number
  oweGroups: HomeBalance[]
  owedGroups: HomeBalance[]
  /** Other currencies with a non-zero balance (not summed: no conversion on the client). */
  otherCurrencies: string[]
  groupCount: number
}

/**
 * Sums the viewer's per-group nets in one currency: their default if they have balances in
 * it, otherwise the currency with the most groups. Groups are sorted by size of balance.
 */
export function summarizeBalances(
  balances: readonly HomeBalance[],
  preferred: string | undefined,
): BalanceSummary {
  const counts = new Map<string, number>()
  for (const b of balances) counts.set(b.currency, (counts.get(b.currency) ?? 0) + 1)
  const currency =
    (preferred && counts.has(preferred) && preferred) ||
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ||
    preferred ||
    'USD'

  const inCurrency = balances.filter((b) => b.currency === currency)
  const byMagnitude = (a: HomeBalance, b: HomeBalance) =>
    Math.abs(b.netCents) - Math.abs(a.netCents)
  const oweGroups = inCurrency.filter((b) => b.netCents < 0).sort(byMagnitude)
  const owedGroups = inCurrency.filter((b) => b.netCents > 0).sort(byMagnitude)
  const owe = oweGroups.reduce((s, b) => s + b.netCents, 0)
  const owed = owedGroups.reduce((s, b) => s + b.netCents, 0)
  const otherCurrencies = [
    ...new Set(
      balances.filter((b) => b.currency !== currency && b.netCents !== 0).map((b) => b.currency),
    ),
  ].sort()

  return {
    currency,
    net: owe + owed,
    owe,
    owed,
    oweGroups,
    owedGroups,
    otherCurrencies,
    groupCount: balances.length,
  }
}
