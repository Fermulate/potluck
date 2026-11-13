interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_APP_URL: string
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_DOCS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Build day and short commit, e.g. "2026.11.13 (3305a99)". Defined in vite.config.ts. */
declare const __APP_VERSION__: string

/** Where the receipt reader's files are served, e.g. "/ocr/7.0.0". Defined in ocr-assets.ts. */
declare const __OCR_PATH__: string
