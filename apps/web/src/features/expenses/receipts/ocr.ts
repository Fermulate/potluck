import type { Worker } from 'tesseract.js'
import { ocrImage } from './image'

/** Fetching the reader, reading, or reading again closer up. */
export type ReadStage = 'loading' | 'reading' | 'closer'

export interface ReadProgress {
  stage: ReadStage
  /** 0 to 1 within the stage. */
  progress: number
}

/** How long the last, colour reading may take (a long receipt on a slow phone). */
const LAST_PASS_MS = 8000

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
 * The reader sees a lossless grayscale copy of the original photo (`ocrImage`). While `enough`
 * says the readings so far fall short, it reads again: from an enlarged copy, then from the
 * plain colour photo, which suits some long receipts better. The texts come back in order, for
 * the caller to pick from. The worker is ended afterwards, so the memory it
 * takes (around 100 MB) goes back at once. Aborting `signal` stops it.
 */
export async function readReceiptText(
  original: Blob,
  {
    onProgress,
    signal,
    enough = () => true,
    lastPassMs = LAST_PASS_MS,
  }: {
    onProgress?: (p: ReadProgress) => void
    signal?: AbortSignal
    enough?: (texts: string[]) => boolean
    /** The colour reading is a last try: past this it is dropped and the readings so far stand. */
    lastPassMs?: number
  } = {},
): Promise<string[]> {
  signal?.throwIfAborted()
  const base = new URL(`${__OCR_PATH__}/`, window.location.origin).href
  let pass = 1
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
  const read = new Set<Blob>()
  const images = [() => ocrImage(original, 1), () => ocrImage(original, 2), async () => original]
  try {
    for (const [index, image] of images.entries()) {
      pass = index + 1
      const blob = await Promise.race([image(), stopped])
      // A copy that could not be made, or the same photo again, adds nothing.
      if (!blob || read.has(blob)) continue
      read.add(blob)
      const limit =
        index === images.length - 1
          ? new Promise<null>((resolve) => setTimeout(() => resolve(null), lastPassMs))
          : null
      const result = await Promise.race([
        worker.recognize(blob),
        stopped,
        ...(limit ? [limit] : []),
      ])
      if (!result) break
      const { data } = result
      texts.push(data.text)
      if (enough(texts)) break
    }
    return texts
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => undefined)
  }
}
