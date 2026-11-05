import { t } from '@potluck/i18n'
import { EmptyState, PageHeader } from '@potluck/ui'
import type { ReactNode } from 'react'

/** Temporary body for routes that are still being built. */
export function RoutePlaceholder({ title }: { title: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-28 lg:pb-10">
      <PageHeader title={title} />
      <EmptyState title={t('common.comingSoon')} align="start" />
    </div>
  )
}
