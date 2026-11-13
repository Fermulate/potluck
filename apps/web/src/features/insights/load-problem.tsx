import { t } from '@potluck/i18n'
import { Button, EmptyState } from '@potluck/ui'
import { RotateCw } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import type { LoadState } from './load-state'

/**
 * Shown instead of an endless skeleton when data cannot load: the offline line (the query runs
 * again by itself once the connection is back) or the error, with a retry.
 */
export function LoadProblem({ query }: { query: LoadState }) {
  const offline = query.isPending && query.fetchStatus === 'paused'
  return (
    <EmptyState
      illustration={offline ? '📡' : '🧯'}
      title={offline ? t('errors.network') : errorMessage(query.error)}
      action={
        <Button variant="secondary" leadingIcon={<RotateCw />} onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      }
    />
  )
}
