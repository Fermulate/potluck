import { readImportFile, type LedgerLabels, type ReadOptions, type SourceFile } from '@potluck/core'

/** Files past this many characters are read in a worker; smaller ones are quicker read in place. */
const WORKER_FROM = 200_000

function inWorker(
  text: string,
  labelSets: LedgerLabels[],
  options: ReadOptions,
): Promise<SourceFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<SourceFile>) => {
      resolve(event.data)
      worker.terminate()
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(event.error ?? new Error(event.message))
    }
    worker.postMessage({ text, labelSets, options })
  })
}

/** Reads an import file's text (Splitwise or Potluck CSV), off the main thread when it is large. */
export async function readFile(
  text: string,
  labelSets: LedgerLabels[],
  options: ReadOptions = {},
): Promise<SourceFile> {
  if (text.length >= WORKER_FROM && typeof Worker !== 'undefined') {
    try {
      return await inWorker(text, labelSets, options)
    } catch {
      // A browser that cannot start the worker still reads the file, just on this thread.
    }
  }
  return readImportFile(text, labelSets, options)
}

/** "sha256:<hex>" of a file's text, to recognise the same file imported twice. */
export async function fingerprint(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}
