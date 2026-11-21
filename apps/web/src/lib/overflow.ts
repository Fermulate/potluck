import { useEffect, useState } from 'react'

/**
 * Tells whether a sideways scroller has more to its right than it shows. Returns a ref callback
 * for the scroller and the flag. Use it to fade the right edge, so a row that runs off the
 * screen reads as "there is more" and not as cut off.
 */
export function useMoreToTheRight<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!node) return
    const update = () => setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 4)
    update()
    node.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [node])
  return [setNode, more]
}

/** Fades the right edge of a scroller. Pair with `useMoreToTheRight`. */
export const FADE_RIGHT = '[mask-image:linear-gradient(to_right,black_82%,transparent)]'
