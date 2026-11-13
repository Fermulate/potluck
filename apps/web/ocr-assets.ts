import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)
const packageDir = (name: string) => dirname(require.resolve(`${name}/package.json`))
const version = (require('tesseract.js/package.json') as { version: string }).version

/**
 * Where the receipt reader lives on our own origin. Versioned, so a service worker cache of an
 * older reader is never mixed with a newer one.
 */
export const OCR_PATH = `/ocr/${version}`

/**
 * The receipt reader's files, served from our origin instead of a CDN (ADR 21): the tesseract.js
 * worker, its WebAssembly core (LSTM builds only, for plain, SIMD and relaxed SIMD devices; each
 * device fetches one) and the English model. Nothing here is in the app bundle or the precache:
 * the first scan downloads them and the service worker keeps them for offline use.
 */
function files(): Record<string, string> {
  const core = packageDir('tesseract.js-core')
  const out: Record<string, string> = {
    'worker.min.js': join(packageDir('tesseract.js'), 'dist', 'worker.min.js'),
    'lang/eng.traineddata.gz': join(
      packageDir('@tesseract.js-data/eng'),
      '4.0.0_best_int',
      'eng.traineddata.gz',
    ),
  }
  for (const build of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
    out[`core/tesseract-core-${build}.wasm.js`] = join(core, `tesseract-core-${build}.wasm.js`)
  }
  return out
}

export function ocrAssets(): Plugin {
  return {
    name: 'potluck:ocr-assets',
    config: () => ({ define: { __OCR_PATH__: JSON.stringify(OCR_PATH) } }),
    configureServer(server) {
      const served = files()
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith(`${OCR_PATH}/`)) return next()
        const source = served[url.slice(OCR_PATH.length + 1)]
        if (!source) return next()
        res.setHeader(
          'Content-Type',
          url.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
        )
        res.end(readFileSync(source))
      })
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files())) {
        this.emitFile({
          type: 'asset',
          fileName: `${OCR_PATH.slice(1)}/${name}`,
          source: readFileSync(source),
        })
      }
    },
  }
}
