import type { Factor, User } from '@supabase/supabase-js'
import { authCallbackUrl } from '@/lib/auth'
import { isolatedClient, supabase } from '@/lib/supabase'

/**
 * Supabase Auth calls behind the Me page's sign in and security section. Each throws the auth
 * error as is (its `code` is translated by `errorMessage`) or an Error whose message is a code
 * the screen words itself.
 */

class CodedError extends Error {}

const FRIENDLY_NAME = 'Authenticator app'

/** Whether the person can sign in with a password today, as far as the app can tell. */
export function hasPassword(user: User): boolean {
  if (user.user_metadata?.has_password === true) return true
  return (user.identities ?? []).some((identity) => identity.provider === 'email')
}

/** The authenticator app factor that is switched on, if any. */
export async function verifiedTotp(): Promise<Factor | null> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.all.find((f) => f.factor_type === 'totp' && f.status === 'verified') ?? null
}

export interface TotpEnrollment {
  factorId: string
  /** An SVG data URL to show as an image. */
  qrCode: string
  /** The base32 key for typing into an app by hand. */
  secret: string
}

/** Starts a fresh authenticator setup, dropping any earlier one that was never finished. */
export async function startTotp(): Promise<TotpEnrollment> {
  const listed = await supabase.auth.mfa.listFactors()
  if (listed.error) throw listed.error
  for (const factor of listed.data.all) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (error) throw error
    }
  }
  // Names must be unique per account, and an unfinished setup may still be on its way out.
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `${FRIENDLY_NAME} ${Date.now()}`,
  })
  if (error) throw error
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Checks a code against the factor; on success the session is stepped up to aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
  if (error) throw error
}

/** Turning it off takes a fresh code, so a borrowed unlocked phone is not enough. */
export async function disableTotp(factorId: string, code: string): Promise<void> {
  await verifyTotp(factorId, code)
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
}

/**
 * Asks Supabase to move the account to `email`. Both the old and the new address get a link;
 * the change lands once both are opened (`double_confirm_changes`).
 */
export async function changeEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser(
    { email: email.trim() },
    { emailRedirectTo: authCallbackUrl('/me') },
  )
  if (error) throw error
}

/**
 * Checks `password` on a throwaway client so this tab's session is left alone; that extra
 * session is signed out right away.
 */
async function checkPassword(email: string, password: string): Promise<void> {
  const client = isolatedClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.code === 'invalid_credentials') throw new CodedError('wrong_current_password')
    throw error
  }
  await client.auth.signOut({ scope: 'local' })
}

export interface PasswordChange {
  email: string
  /** Leave out when the account has no password yet (Google or Apple sign in). */
  current?: string
  next: string
}

/** Sets the new password, then signs out every other session of the account. */
export async function changePassword({ email, current, next }: PasswordChange): Promise<void> {
  if (current !== undefined) await checkPassword(email, current)
  const { error } = await supabase.auth.updateUser({ password: next, data: { has_password: true } })
  if (error) throw error
  const others = await supabase.auth.signOut({ scope: 'others' })
  if (others.error) throw others.error
}
