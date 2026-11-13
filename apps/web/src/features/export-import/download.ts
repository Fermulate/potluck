/** "Trip to Lisbon" -> "trip-to-lisbon-2026-03-01.csv"; `fallback` when the name has no letters. */
export function fileName(name: string, extension: string, fallback = 'potluck'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || fallback}-${new Date().toISOString().slice(0, 10)}.${extension}`
}

/**
 * Hands the browser a file to save. CSV gets a byte order mark so Excel reads accents and
 * currency signs as UTF-8.
 */
export function saveFile(name: string, content: string, type: 'csv' | 'json'): void {
  const blob =
    type === 'csv'
      ? new Blob([String.fromCharCode(0xfeff), content], { type: 'text/csv;charset=utf-8' })
      : new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
