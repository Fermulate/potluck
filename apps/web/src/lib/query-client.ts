import { QueryClient } from '@tanstack/react-query'
import { isNotFoundError } from './errors'

const MAX_RETRIES = 3

/** Retry flaky failures, but show a missing thing at once instead of after three backoffs. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && !isNotFoundError(error)
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: shouldRetry },
  },
})
