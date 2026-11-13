import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { onAuthEvent } from '@/lib/auth'

/**
 * Reacts to auth changes that happen outside a form: signing out (here or in another tab)
 * clears cached data and leaves the app; a password recovery link opens the reset form.
 */
export function useAuthRedirects() {
  const router = useRouter()
  const queryClient = useQueryClient()
  useEffect(() => {
    return onAuthEvent((event) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear()
        void router.invalidate()
        const path = router.state.location.pathname
        const isPublic =
          path === '/' ||
          path.startsWith('/sign-') ||
          path.startsWith('/join/') ||
          path.startsWith('/a/') ||
          path.startsWith('/auth/') ||
          path === '/unsubscribe' ||
          path.endsWith('-password')
        if (!isPublic) void router.navigate({ to: '/sign-in', replace: true })
      }
      if (event === 'PASSWORD_RECOVERY' && router.state.location.pathname !== '/reset-password') {
        void router.navigate({ to: '/reset-password', replace: true })
      }
    })
  }, [router, queryClient])
}
