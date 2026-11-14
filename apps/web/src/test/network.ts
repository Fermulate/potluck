/**
 * Flip the browser's connection the way a real one changes: `navigator.onLine` and the window
 * event that `useOnline()` and React Query's `onlineManager` both listen for. Wrap in `act()`
 * when something is already rendered.
 */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

export const goOffline = () => setOnline(false)
export const goOnline = () => setOnline(true)
