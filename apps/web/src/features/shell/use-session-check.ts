import { useEffect } from 'react'
import { confirmSession } from '@/lib/auth'

/** At most one check this often, however often the window regains focus. */
export const SESSION_CHECK_INTERVAL_MS = 30_000

/**
 * Checks with the server that this device's session still exists when the app opens and each
 * time it comes back to the front, so "Sign out everywhere" on another device ends this one
 * even before it makes a request. The database refuses such a session too (`session_ended`).
 */
export function useSessionCheck() {
  useEffect(() => {
    let last = 0
    const check = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - last < SESSION_CHECK_INTERVAL_MS) return
      last = now
      void confirmSession().catch(() => undefined)
    }
    check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
}
