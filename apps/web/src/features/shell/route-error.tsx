import { t } from '@potluck/i18n'
import { Button, EmptyState } from '@potluck/ui'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { House, RotateCcw } from 'lucide-react'
import { Wordmark } from './brand'

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

/**
 * What an address that matches no screen shows, instead of the router's bare "Not Found". Set as
 * the router's `defaultNotFoundComponent`. It has no app frame around it (the miss happens at the
 * root), so it carries the wordmark and its own way home.
 */
export function RouteNotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-10">
      <Link to="/" className="self-start rounded-pill" aria-label={t('app.name')}>
        <Wordmark />
      </Link>
      <div className="grid flex-1 place-items-center">
        <EmptyState
          as="h1"
          illustration="🧭"
          title={t('errors.notFound')}
          description={t('errors.notFoundBody')}
          action={
            <Button asChild leadingIcon={<House />}>
              <Link to="/home">{t('errors.screen.home')}</Link>
            </Button>
          }
        />
      </div>
    </main>
  )
}
