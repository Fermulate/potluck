import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Toaster, useMediaQuery } from '@potluck/ui'
import { Fragment } from 'react'
import { OfflineBanner } from '@/features/shell/offline'
import { RouteError } from '@/features/shell/route-error'
import { useAuthRedirects } from '@/features/shell/use-auth-redirects'
import { useLocale } from '@/lib/language'
import { useTheme } from '@/styles/use-theme'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  // Errors in a screen land in the router's defaultErrorComponent (main.tsx), inside the app
  // frame; this one catches anything that breaks the root itself.
  errorComponent: RouteError,
})

function RootLayout() {
  const { resolved } = useTheme()
  // The side rail starts at lg; below that the tab bar owns the bottom edge.
  const desktop = useMediaQuery('(min-width: 64rem)')
  useAuthRedirects()
  // Strings are read at render time, so a language switch redraws every screen from here.
  const locale = useLocale()
  return (
    <>
      <Fragment key={locale}>
        <Outlet />
        <OfflineBanner />
      </Fragment>
      {/* Bottom right on desktop, clear of page titles and section tabs. */}
      <Toaster
        label={t('toast.region')}
        theme={resolved}
        position={desktop ? 'bottom-right' : 'top-center'}
      />
    </>
  )
}
