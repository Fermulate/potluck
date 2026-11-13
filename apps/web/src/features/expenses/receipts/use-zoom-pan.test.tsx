import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { clampView, zoomAt } from './use-zoom-pan'
import { ZoomableImage } from './zoomable-image'

describe('zoom math', () => {
  it('keeps a zoomed photo covering its frame', () => {
    expect(clampView({ scale: 2, x: 500, y: -500 }, 200, 100)).toEqual({ scale: 2, x: 100, y: -50 })
    expect(clampView({ scale: 9, x: 0, y: 0 }, 200, 100).scale).toBe(4)
    expect(clampView({ scale: 0.5, x: 30, y: 30 }, 200, 100)).toEqual({ scale: 1, x: 0, y: 0 })
  })

  it('zooms into the point under the finger', () => {
    // Zooming 2x into a point 50px right of center moves the photo 50px left.
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 2, 50, 0)).toEqual({ scale: 2, x: -50, y: 0 })
    expect(zoomAt({ scale: 2, x: -50, y: 0 }, 1, 0, 0)).toEqual({ scale: 1, x: -25, y: 0 })
  })
})

function frameOf() {
  const img = screen.getByRole('img', { name: 'Receipt' })
  const frame = img.parentElement!
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600 }) as DOMRect
  return { img, frame }
}

const pointer = (type: string, id: number, x: number, y: number, extra = {}) =>
  fireEvent[type as 'pointerDown'](frameOf().frame, {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    ...extra,
  })

describe('ZoomableImage', () => {
  it('zooms with the buttons and back out', () => {
    render(<ZoomableImage src="blob:x" alt="Receipt" />)
    const { img } = frameOf()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(img.style.transform).toContain('scale(1.5)')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(img.style.transform).toContain('scale(1)')
  })

  it('zooms and moves with the keyboard, leaving arrows to the page when not zoomed', () => {
    const onPage = vi.fn()
    document.addEventListener('keydown', onPage)
    render(<ZoomableImage src="blob:x" alt="Receipt" />)
    const { img, frame } = frameOf()
    fireEvent.keyDown(frame, { key: 'ArrowLeft' })
    expect(onPage).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(frame, { key: '+' })
    expect(img.style.transform).toContain('scale(1.5)')
    fireEvent.keyDown(frame, { key: 'ArrowLeft' })
    expect(img.style.transform).toContain('translate(48px, 0px)')
    fireEvent.keyDown(frame, { key: 'ArrowDown' })
    expect(img.style.transform).toContain('translate(48px, -48px)')
    expect(onPage).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(frame, { key: '-' })
    fireEvent.keyDown(frame, { key: '=' })
    fireEvent.keyDown(frame, { key: '0' })
    expect(img.style.transform).toContain('scale(1)')
    fireEvent.keyDown(frame, { key: 'a' })
    document.removeEventListener('keydown', onPage)
  })

  it('double clicks to zoom in and out', () => {
    render(<ZoomableImage src="blob:x" alt="Receipt" />)
    const { img, frame } = frameOf()
    fireEvent.doubleClick(frame, { clientX: 200, clientY: 300 })
    expect(img.style.transform).toContain('scale(2.5)')
    fireEvent.doubleClick(frame, { clientX: 200, clientY: 300 })
    expect(img.style.transform).toContain('scale(1)')
  })

  it('double taps, pinches and drags on touch', () => {
    render(<ZoomableImage src="blob:x" alt="Receipt" />)
    const { img } = frameOf()
    // Double tap.
    pointer('pointerDown', 1, 200, 300, { timeStamp: 1 })
    pointer('pointerUp', 1, 200, 300, { timeStamp: 10 })
    pointer('pointerDown', 1, 200, 300, { timeStamp: 100 })
    pointer('pointerUp', 1, 200, 300, { timeStamp: 120 })
    expect(img.style.transform).toContain('scale(2.5)')
    // Drag the zoomed photo.
    pointer('pointerDown', 1, 200, 300)
    pointer('pointerMove', 1, 150, 300)
    expect(img.style.transform).toContain('translate(-50px')
    pointer('pointerUp', 1, 150, 300)
    // Pinch in from 100px apart to 50px: back toward 1x.
    pointer('pointerDown', 1, 150, 300)
    pointer('pointerDown', 2, 250, 300)
    pointer('pointerMove', 2, 200, 300)
    pointer('pointerUp', 2, 200, 300)
    pointer('pointerUp', 1, 150, 300)
    expect(img.style.transform).toContain('scale(1.25)')
  })

  it('swipes to the next photo when it is not zoomed', () => {
    const onSwipe = vi.fn()
    render(<ZoomableImage src="blob:x" alt="Receipt" onSwipe={onSwipe} />)
    act(() => {
      pointer('pointerDown', 1, 300, 300)
      pointer('pointerMove', 1, 150, 310)
      pointer('pointerUp', 1, 150, 310)
    })
    expect(onSwipe).toHaveBeenCalledWith(1)
    pointer('pointerDown', 1, 100, 300)
    pointer('pointerUp', 1, 250, 300)
    expect(onSwipe).toHaveBeenLastCalledWith(-1)
  })
})
