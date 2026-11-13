import { readImportFile, type LedgerLabels, type ReadOptions } from '@potluck/core'

/** The worker side of `self` (the app's types describe a window). */
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{ text: string; labelSets: LedgerLabels[]; options: ReadOptions }>,
      ) => void)
    | null
  postMessage: (message: unknown) => void
}

/** Reads an import file off the main thread, so a large export never freezes the screen. */
scope.onmessage = (event) => {
  scope.postMessage(readImportFile(event.data.text, event.data.labelSets, event.data.options))
}
