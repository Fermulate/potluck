/**
 * A random id for one save, made once per form (a draft) and sent with every try of it. The
 * server keeps it next to what the first try saved, so a retry after a lost reply gets that row
 * back instead of saving it twice (ADR 8 note on request keys).
 *
 * `crypto.randomUUID` needs a secure context; a phone opening a dev server over the network is
 * not one, so the same version 4 id is built from `getRandomValues` there.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
