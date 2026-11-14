import { useEffect } from 'react'
import { confirmSession } from '@/lib/auth'

/** At most one check this often, however often the window regains focus. */
export const SESSION_CHECK_INTERVAL_MS = 30_000

/**
 * Checks with the server that this device's session still exists when the app opens, each time
 * it comes back to the front (focus or becoming visible), and 30 seconds after the last check
 * while it stays on screen, so "Sign out everywhere" on another device ends this one without
 * waiting for a click. Focus and visibility share a throttle; the timer starts again after every
 * check, so on screen no two checks are more than 30 seconds apart. The database refuses such a
 * session too (`session_ended`).
 */
export function useSessionCheck() {
  useEffect(() => {
    let last = 0
    let timer = 0
    const run = () => {
      last = Date.now()
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, SESSION_CHECK_INTERVAL_MS)
      void confirmSession().catch(() => undefined)
    }
    const tick = () => {
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(tick, SESSION_CHECK_INTERVAL_MS)
        return
      }
      run()
    }
    const check = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - last < SESSION_CHECK_INTERVAL_MS) return
      run()
    }
    check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
      window.clearTimeout(timer)
    }
  }, [])
}
