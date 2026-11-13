import { z } from 'zod'

/** Lower cases A to Z only, like `private.ascii_lower`; other letters are left as they are. */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

/**
 * A plain email address as seats and friend links store it: printable ASCII, one `@`, a dot
 * after it, at most 254 characters. Same rule as `private.is_plain_email`.
 */
export function isPlainEmail(value: string): boolean {
  return /^[!-~]+$/.test(value) && /^[^@]+@[^@]+\.[^@]+$/.test(value) && value.length <= 254
}

const plainEmail = z
  .string()
  .trim()
  .transform(asciiLower)
  .refine(isPlainEmail, { message: 'invalid_email' })

/** An optional email: blank means none, anything else must be a plain email. */
const optionalEmail = z
  .string()
  .nullish()
  .transform((value) => (value ?? '').trim())
  .pipe(z.union([z.literal('').transform(() => null), plainEmail]))

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
  email: plainEmail,
})

export type PlaceholderInput = z.input<typeof placeholderSchema>
export type PlaceholderPayload = z.output<typeof placeholderSchema>
export type FriendInviteInput = z.input<typeof friendInviteSchema>
