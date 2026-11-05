import { celebration } from '@potluck/tokens'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePrefersReducedMotion } from './hooks'

export interface ConfettiProps {
  /** Bump this number to fire a burst. 0 never fires. */
  fire: number
  /** Burst origin in viewport fractions. Defaults to the upper middle. */
  origin?: { x: number; y: number }
  /** Number of pieces. */
  count?: number
  /** Short vibration on devices that support it. */
  haptic?: boolean
}

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  w: number
  h: number
  color: string
  shape: 'rect' | 'dot' | 'ribbon'
  wobble: number
}

const GRAVITY = 0.32
const DRAG = 0.985
const LIFETIME_MS = 2600

function makePieces(count: number, ox: number, oy: number, scale: number): Piece[] {
  return Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9
    const speed = (9 + Math.random() * 11) * scale
    const r = Math.random()
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      w: (6 + Math.random() * 6) * scale,
      h: (8 + Math.random() * 10) * scale,
      color: celebration[Math.floor(Math.random() * celebration.length)]!,
      shape: r < 0.55 ? 'rect' : r < 0.8 ? 'dot' : 'ribbon',
      wobble: Math.random() * 10,
    }
  })
}

/**
 * A one-shot canvas burst in the palette colors. Renders nothing when the
 * user prefers reduced motion (the haptic still fires).
 */
export function Confetti({
  fire,
  origin = { x: 0.5, y: 0.35 },
  count = 140,
  haptic = true,
}: ConfettiProps) {
  const reduced = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { x: ox, y: oy } = origin

  useEffect(() => {
    if (fire <= 0) return
    if (haptic && typeof navigator !== 'undefined') navigator.vibrate?.([12, 40, 18])
    if (reduced) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const scale = Math.min(1.2, Math.max(0.75, width / 900))
    const pieces = makePieces(count, ox * width, oy * height, scale)
    const start = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const t = now - start
      ctx.clearRect(0, 0, width, height)
      const fade = t > LIFETIME_MS - 600 ? Math.max(0, (LIFETIME_MS - t) / 600) : 1
      for (const p of pieces) {
        p.vx *= DRAG
        p.vy = p.vy * DRAG + GRAVITY
        p.x += p.vx + Math.sin((t / 180) * 1 + p.wobble) * 0.6
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.globalAlpha = fade
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        if (p.shape === 'dot') {
          ctx.beginPath()
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2)
          ctx.fill()
        } else if (p.shape === 'ribbon') {
          ctx.scale(1, Math.cos(t / 120 + p.wobble))
          ctx.fillRect(-p.w / 4, -p.h, p.w / 2, p.h * 2)
        } else {
          ctx.scale(1, Math.cos(t / 160 + p.wobble))
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        }
        ctx.restore()
      }
      if (t < LIFETIME_MS) frame = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, width, height)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      ctx.clearRect(0, 0, width, height)
    }
  }, [fire, reduced, count, haptic, ox, oy])

  if (reduced || typeof document === 'undefined') return null
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] size-full"
    />,
    document.body,
  )
}
