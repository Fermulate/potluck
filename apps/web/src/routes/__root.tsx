import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from '@potluck/ui'
import { useTheme } from '@/styles/use-theme'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  const { resolved } = useTheme()
  return (
    <>
      <Outlet />
      <Toaster theme={resolved} />
    </>
  )
}
