import { MutationCache, onlineManager, QueryCache, QueryClient } from '@tanstack/react-query'
import { endEndedSession } from './auth'
import { errorCode, isNotFoundError } from './errors'

const MAX_RETRIES = 3

/** The database refuses a token whose session was signed out elsewhere (`private.check_request`). */
export function isSessionEnded(error: unknown): boolean {
  return errorCode(error) === 'session_ended'
}

/** Retry flaky failures, but show a missing thing at once instead of after three backoffs. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && !isNotFoundError(error) && !isSessionEnded(error)
}

/** Any read or write that finds the session ended signs this device out. */
function onError(error: unknown) {
  if (isSessionEnded(error)) void endEndedSession()
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: shouldRetry },
  },
})

// React Query assumes it starts online and only learns otherwise from the next offline event.
// Opening the app with no connection should pause queries and saves from the start, the same
// as `useOnline()` reads it.
if (typeof navigator !== 'undefined') onlineManager.setOnline(navigator.onLine)
