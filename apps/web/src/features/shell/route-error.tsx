import { t } from '@potluck/i18n'
import { Button, EmptyState } from '@potluck/ui'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { House, RotateCcw } from 'lucide-react'

/**
 * What a screen shows when it throws while rendering or loading, instead of the router's bare
 * "Something went wrong!". Set as the router's `defaultErrorComponent` (so the app frame and
 * its navigation stay around the broken screen) and as the root route's `errorComponent`.
 */
export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div role="alert" className="grid min-h-[70dvh] place-items-center px-4 py-10">
      <EmptyState
        as="h1"
        illustration="🫗"
        title={t('errors.screen.title')}
        description={t('errors.screen.body')}
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              leadingIcon={<RotateCcw />}
              onClick={() => {
                // Loaders run again too, so a failed load gets another go.
                reset()
                void router.invalidate()
              }}
            >
              {t('common.retry')}
            </Button>
            <Button asChild variant="secondary" leadingIcon={<House />}>
              <Link to="/home" reloadDocument>
                {t('errors.screen.home')}
              </Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
