import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

/** "/" anywhere outside a text field opens search, as on most sites with a search box. */
export function useSearchShortcut() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      void navigate({ to: '/search' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}
