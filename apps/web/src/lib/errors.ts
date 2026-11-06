import { hasMessage, t } from '@potluck/i18n'

const AUTH_CODES: Record<string, () => string> = {
  invalid_credentials: () => t('errors.auth.invalidCredentials'),
  user_already_exists: () => t('errors.auth.emailTaken'),
  email_exists: () => t('errors.auth.emailTaken'),
  weak_password: () => t('errors.auth.weakPassword'),
  email_not_confirmed: () => t('errors.auth.emailNotConfirmed'),
  over_email_send_rate_limit: () => t('errors.rateLimited'),
  over_request_rate_limit: () => t('errors.rateLimited'),
  otp_expired: () => t('auth.callback.failed'),
}

/** The stable code on an error: RPC errors put it in `message`, auth errors in `code`. */
export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const e = error as { code?: unknown; message?: unknown }
  if (typeof e.message === 'string' && /^[a-z][a-z0-9_]*$/.test(e.message)) return e.message
  if (typeof e.code === 'string' && /^[a-z][a-z0-9_]*$/.test(e.code)) return e.code
  return null
}

/**
 * True when the thing asked for does not exist (or is hidden from the viewer): RPCs raise
 * `*_not_found` with SQLSTATE PT404, which PostgREST answers with HTTP 404, and `.single()`
 * on zero rows fails with PGRST116. Retrying never changes the answer.
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; status?: unknown }
  if (e.code === 'PT404' || e.code === 'PGRST116' || e.status === 404) return true
  return errorCode(error)?.endsWith('_not_found') ?? false
}

/** Screens with their own wording for server codes, e.g. `expenses.errors.sum_mismatch`. */
export type ErrorScope = 'expenses.errors' | 'events.errors'

/**
 * `fetch` rejects with a TypeError when the request never got an answer; each browser words it
 * differently. supabase-js hands that on as a plain `{ message: 'TypeError: Failed to fetch',
 * code: '' }` from PostgREST and as an AuthRetryableFetchError from auth, so the wording is
 * matched on any error without a stable code. Any other failure is a bug, not the network.
 */
const FETCH_FAILURES = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
  'Network request failed',
]

function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!error || typeof error !== 'object' || errorCode(error)) return false
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && FETCH_FAILURES.some((text) => message.includes(text))
}

/**
 * A friendly, translated message for any error the API layer throws. With a `scope`, that
 * screen's wording for a code wins; every screen then shares the auth, general and network
 * fallbacks.
 */
export function errorMessage(error: unknown, scope?: ErrorScope): string {
  const code = errorCode(error)
  if (code) {
    if (scope && hasMessage(`${scope}.${code}`)) {
      return (t as (key: string) => string)(`${scope}.${code}`)
    }
    const auth = AUTH_CODES[code]
    if (auth) return auth()
    const key = `errors.codes.${code}`
    if (hasMessage(key)) return t(key as 'errors.generic')
  }
  if (isNetworkError(error)) return t('errors.network')
  return t('errors.generic')
}
