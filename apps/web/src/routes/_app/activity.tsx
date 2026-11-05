import { createFileRoute } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { RoutePlaceholder } from '@/components/route-placeholder'

export const Route = createFileRoute('/_app/activity')({
  component: () => <RoutePlaceholder title={t('activity.title')} />,
})
