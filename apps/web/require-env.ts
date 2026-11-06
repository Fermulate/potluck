import type { Plugin } from 'vite'

/** What a deployed app cannot run without. */
export const REQUIRED_ENV = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_APP_URL',
] as const

/** Required variables that are missing or blank. */
export function missingEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_ENV.filter((key) => !env[key]?.trim())
}

/** The first `%VITE_*%` placeholder Vite left in an HTML file, if any. */
export function leftoverPlaceholder(html: string): string | null {
  return /%VITE_[A-Z0-9_]+%/.exec(html)?.[0] ?? null
}

/**
 * Without these a production build quietly talks to a local Supabase (src/lib/supabase.ts
 * falls back to it for dev and tests) and ships a literal `%VITE_APP_URL%` in the share tags
 * of index.html. Fail the build instead. Dev and test runs keep their fallbacks.
 */
export function requireEnv(mode: string, env: Record<string, string | undefined>): Plugin {
  return {
    name: 'potluck:require-env',
    apply: 'build',
    buildStart() {
      if (mode !== 'production') return
      const missing = missingEnv(env)
      if (missing.length > 0) {
        this.error(
          `A production build needs ${missing.join(', ')}. ` +
            'Set them in .env.local at the repo root or in the build environment.',
        )
      }
    },
    // After every plugin has had its say, so this sees the HTML that ships.
    writeBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.html')) continue
        const html =
          typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)
        const left = leftoverPlaceholder(html)
        if (left) this.error(`${file.fileName} still contains ${left}. Is it set?`)
      }
    },
  }
}
