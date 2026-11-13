import { hasMessage, t, type MessageKey } from '@potluck/i18n'
import { errorCode, errorMessage } from '@/lib/errors'

/** Wording for the sign in and security flows, then the app wide fallbacks. */
export function accountError(error: unknown): string {
  const code = errorCode(error)
  if (code === 'wrong_current_password') return t('security.password.wrongCurrent')
  const key = `security.errors.${code}`
  if (code && hasMessage(key)) return t(key as MessageKey & `security.errors.${string}`)
  return errorMessage(error)
}
