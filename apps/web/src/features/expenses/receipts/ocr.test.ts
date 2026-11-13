import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderUnavailableError, readReceiptText } from './ocr'

const tess = vi.hoisted(() => ({
  texts: [] as string[],
  fail: false,
  seen: [] as unknown[],
  terminate: vi.fn(async () => undefined),
  logger: null as null | ((m: { status: string; progress: number }) => void),
}))

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: vi.fn(
    async (
      _lang: string,
      _oem: number,
      options: { logger: (m: { status: string; progress: number }) => void },
    ) => {
      if (tess.fail) throw new Error('network')
      tess.logger = options.logger
      options.logger({ status: 'loading tesseract core', progress: 0.5 })
      return {
        recognize: vi.fn(async (image: unknown) => {
          tess.seen.push(image)
          tess.logger?.({ status: 'recognizing text', progress: 1 })
          return { data: { text: tess.texts.shift() ?? '' } }
        }),
        terminate: tess.terminate,
      }
    },
  ),
}))

const copies = vi.hoisted(() => ({ first: 'native' as unknown }))
vi.mock('./image', () => ({
  ocrImage: vi.fn(async (_file: Blob, pass: 1 | 2) => (pass === 1 ? copies.first : 'closer')),
}))

beforeEach(() => {
  tess.texts = ['first', 'second', 'third']
  copies.first = 'native'
  tess.fail = false
  tess.seen = []
  tess.terminate.mockClear()
})

const photo = new Blob(['jpg'], { type: 'image/jpeg' })

describe('readReceiptText', () => {
  it('reads once when the first reading is enough, and ends the worker', async () => {
    const stages: string[] = []
    const texts = await readReceiptText(photo, { onProgress: (p) => stages.push(p.stage) })
    expect(texts).toEqual(['first'])
    expect(tess.seen).toEqual(['native'])
    expect(stages).toEqual(['loading', 'reading'])
    expect(tess.terminate).toHaveBeenCalled()
  })

  it('reads again closer up when the first reading falls short', async () => {
    const stages: string[] = []
    const texts = await readReceiptText(photo, {
      enough: (texts) => texts.includes('second'),
      onProgress: (p) => stages.push(p.stage),
    })
    expect(texts).toEqual(['first', 'second'])
    expect(tess.seen).toEqual(['native', 'closer'])
    expect(stages).toContain('closer')
  })

  it('reads the plain colour photo last when the others still fall short', async () => {
    const texts = await readReceiptText(photo, { enough: () => false })
    expect(texts).toEqual(['first', 'second', 'third'])
    expect(tess.seen).toEqual(['native', 'closer', photo])
  })

  it('never reads the same photo twice', async () => {
    // The photo could not be decoded, so the first reading already used the original.
    copies.first = photo
    const texts = await readReceiptText(photo, { enough: () => false })
    expect(tess.seen).toEqual([photo, 'closer'])
    expect(texts).toEqual(['first', 'second'])
  })

  it('says the reader is unavailable when it cannot start', async () => {
    tess.fail = true
    await expect(readReceiptText(photo)).rejects.toBeInstanceOf(ReaderUnavailableError)
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(readReceiptText(photo, { signal: controller.signal })).rejects.toThrow('stopped')
  })
})
