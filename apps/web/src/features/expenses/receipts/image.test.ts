import { afterEach, describe, expect, it, vi } from 'vitest'
import { ocrImage, ocrScale, previewUrl, stretchGray } from './image'

describe('the copy the reader sees', () => {
  it('keeps every pixel of a normal photo, cuts a huge one down, enlarges a small one once', () => {
    expect(ocrScale(1512, 2016, 1)).toBe(1)
    expect(ocrScale(3024, 4032, 1)).toBeCloseTo(0.744, 3)
    expect(ocrScale(760, 1000, 2)).toBe(2)
    expect(ocrScale(1512, 2016, 2)).toBeCloseTo(1.19, 2)
    expect(ocrScale(3024, 4032, 2)).toBeNull()
  })

  it('turns pixels gray and stretches faded print to black on white', () => {
    // 100 pixels: one very dark, 98 mid grey, one very light. The 1% ends set black and white.
    const pixels = new Uint8ClampedArray(100 * 4)
    for (let p = 0; p < 100; p++) pixels.set([150, 150, 150, 255], p * 4)
    pixels.set([40, 60, 80, 255], 0)
    pixels.set([250, 250, 250, 255], 99 * 4)
    stretchGray(pixels)
    const gray = (p: number) => [pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]]
    expect(gray(0)).toEqual([0, 0, 0])
    expect(gray(99)).toEqual([255, 255, 255])
    expect(new Set(gray(50)).size).toBe(1)
    expect(pixels[50 * 4 + 3]).toBe(255)
  })

  it('reads a photo the browser cannot decode as it is, once', async () => {
    // jsdom has no createImageBitmap.
    const heic = new Blob(['x'], { type: 'image/heic' })
    expect(await ocrImage(heic, 1)).toBe(heic)
    expect(await ocrImage(heic, 2)).toBeNull()
  })
})

describe('the preview of a picked file', () => {
  const real = URL.createObjectURL
  afterEach(() => {
    URL.createObjectURL = real
  })

  // A blob: URL is served with its blob's type, so a picked page must never keep text/html.
  const shown = (file: File) => {
    const make = vi.fn((_: Blob) => 'blob:preview')
    URL.createObjectURL = make
    expect(previewUrl(file)).toBe('blob:preview')
    return make.mock.calls[0]![0]
  }

  it('keeps a photo typed as the image it is, with the same bytes', async () => {
    const blob = shown(new File(['jpeg bytes'], 'receipt.jpg', { type: 'image/jpeg' }))
    expect(blob.type).toBe('image/jpeg')
    expect(await blob.text()).toBe('jpeg bytes')
  })

  it('never serves a picked page or script as one', async () => {
    const page = '<script>alert(1)</script>'
    for (const type of ['text/html', 'application/javascript', '']) {
      const blob = shown(new File([page], 'receipt.html', { type }))
      expect(blob.type).toBe('application/octet-stream')
      expect(await blob.text()).toBe(page)
    }
  })
})
