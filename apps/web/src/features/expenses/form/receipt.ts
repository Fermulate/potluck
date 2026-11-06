/** Types the private `receipts` bucket accepts. */
export const RECEIPT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

const BY_EXTENSION: Record<string, (typeof RECEIPT_TYPES)[number]> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  pdf: 'application/pdf',
}

/** What the file picker offers: the types, plus extensions for files the browser cannot type. */
export const RECEIPT_ACCEPT = [...RECEIPT_TYPES, '.heic', '.heif'].join(',')

/**
 * The type to store a picked file as, or null when receipts cannot take it. Some browsers hand
 * over HEIC photos with an empty type, so an untyped file is judged by its extension.
 */
export function receiptType(file: File): string | null {
  if ((RECEIPT_TYPES as readonly string[]).includes(file.type)) return file.type
  if (file.type !== '' && file.type !== 'application/octet-stream') return null
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  return BY_EXTENSION[extension] ?? null
}

/** File extension for an upload, from its type or name. */
export function receiptExtension(file: File): string {
  const fromType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  }
  return fromType[file.type] ?? file.name.split('.').pop() ?? 'jpg'
}
