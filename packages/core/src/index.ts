/**
 * Platform-neutral domain logic (money, splits, balances).
 * No DOM or React DOM imports: this package is shared with the future mobile app.
 */

/**
 * Split an amount in minor units (e.g. cents) evenly across `parts` people.
 * Leftover minor units go to the first shares so the total always adds up.
 */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(totalMinor)) throw new RangeError('totalMinor must be an integer')
  if (!Number.isInteger(parts) || parts < 1)
    throw new RangeError('parts must be a positive integer')

  const base = Math.trunc(totalMinor / parts)
  const remainder = totalMinor - base * parts
  const step = Math.sign(remainder)

  return Array.from({ length: parts }, (_, i) => base + (i < Math.abs(remainder) ? step : 0))
}
