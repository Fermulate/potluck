import {
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface View {
  scale: number
  x: number
  y: number
}

export const MAX_ZOOM = 4
const TAP_ZOOM = 2.5
const SWIPE = 60
const DOUBLE_TAP_MS = 300

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Keeps a zoomed image covering its frame: it can be moved only as far as its overflow. */
export function clampView(view: View, width: number, height: number): View {
  const scale = clamp(view.scale, 1, MAX_ZOOM)
  const maxX = ((scale - 1) * width) / 2
  const maxY = ((scale - 1) * height) / 2
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) }
}

/**
 * Zooming into the point at `(px, py)` (relative to the frame's center) by `scale`, from `view`:
 * that point stays under the finger.
 */
export function zoomAt(view: View, scale: number, px: number, py: number): View {
  const ratio = scale / view.scale
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/**
 * Pinch and double tap to zoom, drag to move a zoomed photo, swipe sideways to go to the next
 * one when it is not zoomed. Pointer events, so touch, pen and mouse behave the same; the
 * buttons (`zoomIn`, `zoomOut`) cover the keyboard.
 */
export function useZoomPan({ onSwipe }: { onSwipe?: (step: 1 | -1) => void } = {}) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const start = useRef<{
    view: View
    x: number
    y: number
    distance: number
    moved: boolean
  } | null>(null)
  const lastTap = useRef(0)
  const frame = useRef<HTMLElement | null>(null)

  const size = () => {
    const rect = frame.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0, rect }
  }
  const settle = (next: View) => {
    const { width, height } = size()
    setView(clampView(next, width, height))
  }
  const fromCenter = (clientX: number, clientY: number) => {
    const { width, height, rect } = size()
    return {
      px: clientX - (rect?.left ?? 0) - width / 2,
      py: clientY - (rect?.top ?? 0) - height / 2,
    }
  }
  const toggleAt = (clientX: number, clientY: number) => {
    if (view.scale > 1) return settle({ scale: 1, x: 0, y: 0 })
    const { px, py } = fromCenter(clientX, clientY)
    settle(zoomAt(view, TAP_ZOOM, px, py))
  }
  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    frame.current = e.currentTarget
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    start.current = { view, x: e.clientX, y: e.clientY, distance: distance(), moved: false }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const from = start.current
    if (pointers.current.size >= 2 && from.distance > 0) {
      from.moved = true
      const scale = clamp((from.view.scale * distance()) / from.distance, 1, MAX_ZOOM)
      const [a, b] = [...pointers.current.values()]
      const { px, py } = fromCenter((a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
      settle(zoomAt(from.view, scale, px, py))
      return
    }
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) from.moved = true
    if (from.view.scale > 1) settle({ ...from.view, x: from.view.x + dx, y: from.view.y + dy })
    else setView({ scale: 1, x: dx * 0.6, y: 0 })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const from = start.current
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) {
      // One finger of a pinch lifted: carry on from here with the other.
      const [rest] = [...pointers.current.values()]
      start.current = { view, x: rest!.x, y: rest!.y, distance: 0, moved: true }
      return
    }
    start.current = null
    setDragging(false)
    if (!from) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (from.view.scale === 1 && view.scale === 1) {
      setView({ scale: 1, x: 0, y: 0 })
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) && onSwipe) {
        onSwipe(dx < 0 ? 1 : -1)
        return
      }
    }
    if (!from.moved && e.pointerType !== 'mouse') {
      const now = e.timeStamp
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0
        toggleAt(e.clientX, e.clientY)
      } else {
        lastTap.current = now
      }
    }
  }

  const onDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
    frame.current = e.currentTarget
    toggleAt(e.clientX, e.clientY)
  }

  const step = (factor: number) => settle(zoomAt(view, view.scale * factor, 0, 0))

  const style: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transition: dragging ? 'none' : 'transform 180ms ease-out',
    touchAction: 'none',
  }

  return {
    view,
    style,
    frameProps: {
      ref: (element: HTMLElement | null) => {
        frame.current = element
      },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
      style: { touchAction: 'none' } as CSSProperties,
    },
    zoomIn: () => step(1.5),
    zoomOut: () => step(1 / 1.5),
    reset: () => setView({ scale: 1, x: 0, y: 0 }),
  }
}
