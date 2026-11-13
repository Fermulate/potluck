import type { Worker } from 'tesseract.js'

export type ReadStage = 'loading' | 'reading'

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
 * so later scans work offline. Each read starts a worker and ends it, so the memory it takes
 * (around 100 MB) goes back as soon as the text is out. Aborting `signal` stops it.
 */
export async function readReceiptText(
  image: Blob,
  { onProgress, signal }: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  signal?.throwIfAborted()
  const base = new URL(`${__OCR_PATH__}/`, window.location.origin).href
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
          stage: m.status === 'recognizing text' ? 'reading' : 'loading',
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
  try {
    signal?.throwIfAborted()
    const { data } = await Promise.race([worker.recognize(image), stopped])
    return data.text
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => undefined)
  }
}
