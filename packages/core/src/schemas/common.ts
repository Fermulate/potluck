import { z } from 'zod'

/**
 * Custom validation failures use a stable code as the issue `message` (e.g.
 * `splits_sum_mismatch`) so the UI can translate it with `errors.validation.<code>`.
 */

/** Any 8-4-4-4-12 hex id. Lenient on the version nibble so seeded ids also pass. */
export const id = z.guid()

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'invalid_currency')

export const positiveCents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const dateOnly = z.iso.date()

export const timestamp = z.iso.datetime({ offset: true })

/** Optional free text that is trimmed, with blank meaning null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))
