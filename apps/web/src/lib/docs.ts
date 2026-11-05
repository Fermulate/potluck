/** The public user guide, used when `VITE_DOCS_URL` is not set. */
export const DEFAULT_DOCS_URL = 'https://potluck-docs.potluck-web.workers.dev'

/** Where people report bugs and ask for things. */
export const REPORT_PROBLEM_URL = 'https://github.com/Fermulate/potluck/issues/new/choose'

/** Base URL of the user guide, without a trailing slash. */
export function docsOrigin(configured: string | undefined = import.meta.env.VITE_DOCS_URL): string {
  const base = configured?.trim() || DEFAULT_DOCS_URL
  return base.replace(/\/+$/, '')
}

/**
 * Full URL of a guide page. `path` is a page slug with an optional heading anchor, as the guide
 * serves it: `/expenses/splits/#by-item`.
 */
export function docsUrl(path: `/${string}`, base: string = docsOrigin()): string {
  return `${base}${path}`
}
