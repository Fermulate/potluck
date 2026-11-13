import { z } from 'zod'

/** An optional email: blank means none, anything else is trimmed, lower cased and checked. */
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === '' ? null : value))
  .pipe(z.email().max(254).nullable())
  .nullish()
  .transform((value) => value ?? null)

/**
 * Arguments for `add_placeholder_member(group_id, display_name, email)`: someone added by name
 * before they have an account. Same rules as `private.placeholder_name` and
 * `private.placeholder_email`.
 */
export const placeholderSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  email: optionalEmail,
})

/** Argument for `create_friend_invite(email)`: the email is required. */
export const friendInviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
})

export type PlaceholderInput = z.input<typeof placeholderSchema>
export type PlaceholderPayload = z.output<typeof placeholderSchema>
export type FriendInviteInput = z.input<typeof friendInviteSchema>
