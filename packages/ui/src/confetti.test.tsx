import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Confetti } from './confetti'
import { preferReducedMotion } from './test/motion'

const ctx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  globalAlpha: 1,
  fillStyle: '',
}

let frames: FrameRequestCallback[]
const vibrate = vi.fn()

beforeEach(() => {
  frames = []
  ctx.globalAlpha = 1
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Runs the newest scheduled frame at `time` ms after the burst started. */
function step(time: number) {
  const frame = frames.at(-1)!
  frames = []
  frame(time)
}

function canvas() {
  return document.body.querySelector('canvas')
}

describe('Confetti', () => {
  it('renders a hidden canvas but stays idle until fired', () => {
    render(<Confetti fire={0} />)
    expect(canvas()).toHaveAttribute('aria-hidden', 'true')
    expect(frames).toHaveLength(0)
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('buzzes and draws every piece shape until the burst ends', () => {
    render(<Confetti fire={1} count={60} />)
    expect(vibrate).toHaveBeenCalledWith([12, 40, 18])
    expect(ctx.setTransform).toHaveBeenCalled()

    step(100)
    expect(ctx.save).toHaveBeenCalledTimes(60)
    expect(ctx.arc).toHaveBeenCalled()
    expect(ctx.fillRect).toHaveBeenCalled()
    expect(frames).toHaveLength(1)

    step(2300)
    expect(ctx.globalAlpha).toBeLessThan(1)
    step(2700)
    expect(frames).toHaveLength(0)
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, window.innerWidth, window.innerHeight)
  })

  it('fires again when the counter is bumped', () => {
    const { rerender } = render(<Confetti fire={1} haptic={false} origin={{ x: 0.2, y: 0.8 }} />)
    expect(vibrate).not.toHaveBeenCalled()
    rerender(<Confetti fire={2} haptic={false} origin={{ x: 0.2, y: 0.8 }} />)
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(frames).toHaveLength(2)
  })

  it('stops drawing on unmount', () => {
    const { unmount } = render(<Confetti fire={1} />)
    unmount()
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(canvas()).toBeNull()
  })

  it('only buzzes with reduced motion', () => {
    preferReducedMotion()
    render(<Confetti fire={1} />)
    expect(vibrate).toHaveBeenCalled()
    expect(canvas()).toBeNull()
    expect(frames).toHaveLength(0)
  })

  it('does nothing visual when the canvas has no 2d context', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    render(<Confetti fire={1} />)
    expect(frames).toHaveLength(0)
  })
})
