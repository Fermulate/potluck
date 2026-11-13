import { describe, expect, it } from 'vitest'
import { ocrImage, ocrScale, stretchGray } from './image'

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
