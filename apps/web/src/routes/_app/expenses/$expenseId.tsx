import { createFileRoute } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { RoutePlaceholder } from '@/components/route-placeholder'

export const Route = createFileRoute('/_app/expenses/$expenseId')({
  component: () => <RoutePlaceholder title={t('expenses.title')} />,
})
