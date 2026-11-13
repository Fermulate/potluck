/**
 * Account security that needs the database or an edge function: two-step recovery codes.
 * Email, password, sessions and authenticator factors are Supabase Auth calls made by the app.
 * Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { PotluckClient } from './index'

export const accountKeys = {
  all: ['potluck', 'account'] as const,
  recoveryCodesLeft: (userId: string) =>
    ['potluck', 'account', 'recovery-codes-left', userId] as const,
}

/** Ten fresh recovery codes (ABCDE-23456), shown once. Older codes stop working. Needs aal2. */
export async function createRecoveryCodes(client: PotluckClient): Promise<string[]> {
  const { data, error } = await client.rpc('create_mfa_recovery_codes')
  if (error) throw error
  return data ?? []
}

export async function fetchRecoveryCodesLeft(client: PotluckClient): Promise<number> {
  const { data, error } = await client.rpc('mfa_recovery_codes_left')
  if (error) throw error
  return data ?? 0
}

export const recoveryCodesLeftQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: accountKeys.recoveryCodesLeft(userId),
    queryFn: () => fetchRecoveryCodesLeft(client),
  })

/** An error whose `message` is a stable code, like the ones RPCs raise. */
class CodedError extends Error {}

/**
 * Trades a recovery code for removing every second factor (the `mfa-recover` edge function).
 * Throws an error with message `invalid_recovery_code` when the code does not match. Refresh
 * the session afterwards: the new token no longer needs a second step.
 */
export async function recoverWithCode(client: PotluckClient, code: string): Promise<void> {
  await invokeWithCodes(client, 'mfa-recover', { code })
}

/**
 * Calls off an email change still waiting for its links (`cancel-email-change`). Refresh the
 * session afterwards to drop the pending address from it.
 */
export async function cancelEmailChange(client: PotluckClient): Promise<void> {
  await invokeWithCodes(client, 'cancel-email-change', {})
}

/** Drops the recovery codes once two-step sign in is off. Returns how many went. */
export async function clearRecoveryCodes(client: PotluckClient): Promise<number> {
  const { data, error } = await client.rpc('clear_mfa_recovery_codes')
  if (error) throw error
  return data ?? 0
}

/** POSTs to an edge function; a non 2xx answer with `{ error: code }` throws that code. */
async function invokeWithCodes(client: PotluckClient, name: string, body: object): Promise<void> {
  const { error } = await client.functions.invoke(name, { method: 'POST', body })
  if (!error) return
  // A non 2xx answer carries the fetch response; its JSON body names the problem.
  const response = (error as { context?: { json?: unknown } }).context
  if (typeof response?.json === 'function') {
    const answer = (await Promise.resolve()
      .then(() => (response.json as () => Promise<unknown>)())
      .catch(() => null)) as { error?: unknown } | null
    if (typeof answer?.error === 'string') throw new CodedError(answer.error)
  }
  throw error
}
