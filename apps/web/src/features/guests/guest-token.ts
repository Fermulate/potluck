/**
 * What a guest's browser remembers per link: the token the server handed back (proof that this
 * browser wrote the answer, so it can edit it) and the name they typed. Storage can be missing or
 * blocked (private windows, strict settings); the page then works, it just forgets on reload.
 */
export interface GuestMemory {
  token: string
  name: string
}

const key = (code: string) => `potluck.guest.${code}`

export function readGuestMemory(code: string): GuestMemory | null {
  try {
    const raw = window.localStorage.getItem(key(code))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<GuestMemory>
    return typeof value.token === 'string' && value.token
      ? { token: value.token, name: typeof value.name === 'string' ? value.name : '' }
      : null
  } catch {
    return null
  }
}

export function writeGuestMemory(code: string, memory: GuestMemory): void {
  try {
    window.localStorage.setItem(key(code), JSON.stringify(memory))
  } catch {
    // Nowhere to keep it: the answer is saved, only editing from this browser is lost.
  }
}
