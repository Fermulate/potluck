import { readImportFile, type LedgerLabels, type SourceFile } from '@potluck/core'

/** Files past this size are read in a worker; smaller ones are quicker read in place. */
const WORKER_FROM_BYTES = 200_000

function inWorker(text: string, labelSets: LedgerLabels[]): Promise<SourceFile> {
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
    worker.postMessage({ text, labelSets })
  })
}

/** Reads a chosen file as an import source (Splitwise or Potluck CSV). */
export async function readFile(file: Blob, labelSets: LedgerLabels[]): Promise<SourceFile> {
  const text = await file.text()
  if (file.size >= WORKER_FROM_BYTES && typeof Worker !== 'undefined') {
    try {
      return await inWorker(text, labelSets)
    } catch {
      // A browser that cannot start the worker still reads the file, just on this thread.
    }
  }
  return readImportFile(text, labelSets)
}
