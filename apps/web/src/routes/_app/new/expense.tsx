import { createFileRoute } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { RoutePlaceholder } from '@/components/route-placeholder'

import { validateNewExpenseSearch } from '@/features/expenses/search-params'

export const Route = createFileRoute('/_app/new/expense')({
  validateSearch: validateNewExpenseSearch,
  component: () => <RoutePlaceholder title={t('nav.quickAdd.expense')} />,
})
