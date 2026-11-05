import { createFileRoute } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { RoutePlaceholder } from '@/components/route-placeholder'

import { validateSettleSearch } from '@/features/expenses/search-params'

export const Route = createFileRoute('/_app/new/settle')({
  validateSearch: validateSettleSearch,
  component: () => <RoutePlaceholder title={t('nav.quickAdd.settle')} />,
})
