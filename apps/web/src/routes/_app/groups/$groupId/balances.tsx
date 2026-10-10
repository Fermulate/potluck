import { createFileRoute } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { RoutePlaceholder } from '@/components/route-placeholder'

export const Route = createFileRoute('/_app/groups/$groupId/balances')({
  component: () => <RoutePlaceholder title={t('balances.title')} />,
})
