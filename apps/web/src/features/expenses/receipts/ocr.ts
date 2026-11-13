import type { Worker } from 'tesseract.js'
import { ocrImage } from './image'

/** Fetching the reader, reading, or reading again closer up. */
export type ReadStage = 'loading' | 'reading' | 'closer'

export interface ReadProgress {
  stage: ReadStage
  /** 0 to 1 within the stage. */
  progress: number
}

/** The reader could not start: almost always the first scan without a connection. */
export class ReaderUnavailableError extends Error {
  constructor(cause: unknown) {
    super('reader_unavailable', { cause })
  }
}

/**
 * Reads the text on a photo, on the device (ADR 21). tesseract.js is imported only here, so it
 * is fetched the first time someone scans and never weighs on the app bundle; its worker, core
 * and English model come from our own origin (`ocr-assets.ts`) and the service worker keeps them,
 * so later scans work offline.
 *
 * The reader sees a lossless grayscale copy of the original photo (`ocrImage`). When `enough`
 * says the first reading falls short, it reads once more from an enlarged copy; the texts come
 * back in order, for the caller to pick from. The worker is ended afterwards, so the memory it
 * takes (around 100 MB) goes back at once. Aborting `signal` stops it.
 */
export async function readReceiptText(
  original: Blob,
  {
    onProgress,
    signal,
    enough = () => true,
  }: {
    onProgress?: (p: ReadProgress) => void
    signal?: AbortSignal
    enough?: (text: string) => boolean
  } = {},
): Promise<string[]> {
  signal?.throwIfAborted()
  const base = new URL(`${__OCR_PATH__}/`, window.location.origin).href
  let pass: 1 | 2 = 1
  let worker: Worker
  try {
    const { createWorker, OEM } = await import('tesseract.js')
    signal?.throwIfAborted()
    worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) =>
        onProgress?.({
          stage: m.status !== 'recognizing text' ? 'loading' : pass === 1 ? 'reading' : 'closer',
          progress: m.progress,
        }),
    })
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    throw new ReaderUnavailableError(error)
  }
  let stop = () => {}
  const stopped = new Promise<never>((_, reject) => {
    stop = () => reject(signal?.reason)
    signal?.addEventListener('abort', stop, { once: true })
  })
  const texts: string[] = []
  try {
    for (const next of [1, 2] as const) {
      pass = next
      const image = await Promise.race([ocrImage(original, next), stopped])
      if (!image) break
      const { data } = await Promise.race([worker.recognize(image), stopped])
      texts.push(data.text)
      if (enough(data.text)) break
    }
    return texts
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => undefined)
  }
}
