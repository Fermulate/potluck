import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { Toaster, useMediaQuery } from '@potluck/ui'
import { useAuthRedirects } from '@/features/shell/use-auth-redirects'
import { useTheme } from '@/styles/use-theme'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  const { resolved } = useTheme()
  // The side rail starts at lg; below that the tab bar owns the bottom edge.
  const desktop = useMediaQuery('(min-width: 64rem)')
  useAuthRedirects()
  return (
    <>
      <Outlet />
      {/* Bottom right on desktop, clear of page titles and section tabs. */}
      <Toaster
        label={t('toast.region')}
        theme={resolved}
        position={desktop ? 'bottom-right' : 'top-center'}
      />
    </>
  )
}
