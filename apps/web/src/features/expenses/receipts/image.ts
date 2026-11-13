/** Longest side of a stored photo: sharp enough to read every line of a receipt. */
export const MAX_EDGE = 2000
const QUALITY = 0.82

/** The size that fits `width` x `height` inside `max` on its longest side, never upscaled. */
export function fitWithin(width: number, height: number, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height, 1))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Shrinks a photo before it is uploaded or read: at most MAX_EDGE on its longest side, as JPEG
 * on white (a phone photo of a receipt goes from about 4 MB to about 400 KB). The camera's
 * orientation is applied, and re-encoding drops the photo's metadata (location included).
 * Anything the browser cannot decode (HEIC outside Safari, PDFs) is returned as it was.
 */
export async function prepareImage(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) && !(file.type === 'image/heic' && canDecodeHeic())) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob) return file
    const name = `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

/** Safari decodes HEIC photos; other browsers upload them untouched. */
function canDecodeHeic(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}
