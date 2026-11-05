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
