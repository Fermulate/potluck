/**
 * What a browser remembers per shared link (a guest link, a quick poll): the token that proves
 * this browser wrote the answer (a guest link's server hands it back, a quick poll's browser makes
 * it), plus whatever the page needs next time.
 * Storage can be missing or blocked (private windows, strict settings); the page then works, it
 * just forgets on reload.
 */
export interface LinkMemory<T> {
  read(code: string): T | null
  write(code: string, value: T): void
  forget(code: string): void
}

/**
 * One record per code under `<prefix>.<code>`. `parse` gets whatever JSON was stored and returns
 * null for anything it does not recognize, so junk in storage reads as nothing remembered.
 */
export function linkMemory<T>(prefix: string, parse: (stored: unknown) => T | null): LinkMemory<T> {
  const key = (code: string) => `${prefix}.${code}`
  return {
    read(code) {
      try {
        const raw = window.localStorage.getItem(key(code))
        return raw ? parse(JSON.parse(raw)) : null
      } catch {
        return null
      }
    },
    write(code, value) {
      try {
        window.localStorage.setItem(key(code), JSON.stringify(value))
      } catch {
        // Nowhere to keep it: the answer is saved, only editing from this browser is lost.
      }
    },
    forget(code) {
      try {
        window.localStorage.removeItem(key(code))
      } catch {
        // Nothing was kept.
      }
    },
  }
}

/** The usual record: the token that proves this browser wrote its answer, and the name typed. */
export interface TokenMemory {
  token: string
  name: string
}

/** Reads a `TokenMemory`; a record without a token is nothing remembered. */
export function parseTokenMemory(stored: unknown): TokenMemory | null {
  const value = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  return typeof value.token === 'string' && value.token
    ? { token: value.token, name: typeof value.name === 'string' ? value.name : '' }
    : null
}
