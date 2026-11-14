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
  /**
   * What the viewer is owed and owes in each other currency, kept apart (no conversion on the
   * client), by currency code. Only currencies with something on either side.
   */
  otherCurrencies: { currency: string; owed: number; owe: number }[]
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
  const others = new Map<string, { currency: string; owed: number; owe: number }>()
  for (const b of balances) {
    if (b.currency === currency || b.netCents === 0) continue
    const totals = others.get(b.currency) ?? { currency: b.currency, owed: 0, owe: 0 }
    if (b.netCents > 0) totals.owed += b.netCents
    else totals.owe += b.netCents
    others.set(b.currency, totals)
  }
  const otherCurrencies = [...others.values()].sort((a, b) => a.currency.localeCompare(b.currency))

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
