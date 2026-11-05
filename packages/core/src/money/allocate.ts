/** Map of user id to an amount in minor units (cents). */
export type Shares = Record<string, number>

/** Plain code-point comparison, so ordering matches Postgres `uuid`/`C` collation ordering. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Largest remainder allocation of `total` (non-negative integer) across integer `weights`.
 *
 * Each user gets floor(total * w / sum(w)). The leftover units go one each to the users with
 * the largest fractional remainder; ties are broken by user id in ascending order. The result
 * always sums exactly to `total`. Uses BigInt so large weights never lose precision.
 */
export function allocate(total: number, weights: ReadonlyMap<string, bigint>): Shares {
  const ids = [...weights.keys()].sort(compareIds)
  const sum = ids.reduce((acc, id) => acc + weights.get(id)!, 0n)
  const bigTotal = BigInt(total)

  const rows = ids.map((id) => {
    const numerator = bigTotal * weights.get(id)!
    return { id, share: numerator / sum, remainder: numerator % sum }
  })

  let leftover = bigTotal - rows.reduce((acc, row) => acc + row.share, 0n)
  const byRemainder = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? compareIds(a.id, b.id) : a.remainder > b.remainder ? -1 : 1,
  )
  for (const row of byRemainder) {
    if (leftover === 0n) break
    row.share += 1n
    leftover -= 1n
  }

  const shares: Shares = {}
  for (const row of rows) shares[row.id] = Number(row.share)
  return shares
}
