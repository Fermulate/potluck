import { useEffect, useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * Whether the browser thinks it is online: `navigator.onLine`, kept fresh by the `online` and
 * `offline` events. React Query's `onlineManager` follows the same events, so a save that would
 * pause offline and this flag agree.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * While `active`, closing or reloading the tab asks first (the browser's own "Leave site?"),
 * for a form whose entry would otherwise be lost, like one that cannot be saved offline.
 */
export function useWarnBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Older browsers only ask when returnValue is set.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])
}
