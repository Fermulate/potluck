import { z } from 'zod'
import { currencyCode, id, optionalText, positiveCents, timestamp } from './common'

/** Arguments for `settle_up(group_id, to_user, amount_cents, currency, note)`. */
export const settleUpSchema = z.object({
  group_id: id,
  to_user: id,
  amount_cents: positiveCents,
  currency: currencyCode,
  note: optionalText(280),
})

/** Arguments for `create_invite(group_id, role, max_uses, expires_at, email)`. */
export const inviteCreateSchema = z.object({
  group_id: id,
  /** Invites can never grant ownership. */
  role: z.enum(['admin', 'member']).default('member'),
  max_uses: z.number().int().positive().max(10_000).nullish().default(null),
  expires_at: timestamp.nullish().default(null),
  email: z.string().trim().toLowerCase().pipe(z.email()).nullish().default(null),
})

export type SettleUpInput = z.input<typeof settleUpSchema>
export type SettleUpPayload = z.output<typeof settleUpSchema>
export type InviteCreateInput = z.input<typeof inviteCreateSchema>
export type InviteCreatePayload = z.output<typeof inviteCreateSchema>
