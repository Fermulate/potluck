export interface LoadState {
  isPending: boolean
  isError: boolean
  error: unknown
  fetchStatus: 'fetching' | 'paused' | 'idle'
  refetch: () => unknown
}

/** True when a query has nothing to show and will not get it by waiting: offline, or failed. */
export function hasLoadProblem(query: LoadState): boolean {
  return (query.isPending && query.fetchStatus === 'paused') || query.isError
}
