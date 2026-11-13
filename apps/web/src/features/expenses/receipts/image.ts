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
 * Shrinks a photo before it is uploaded (OCR reads `ocrImage` instead): at most MAX_EDGE on its longest side, as JPEG
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

/** The OCR copy is cut down past this, so a 12 MP photo stays quick to read. */
const OCR_MAX_EDGE = 3000
/** A second, closer reading upscales small photos to about this. */
const OCR_UPSCALE_EDGE = 2400

/**
 * How much to scale a photo for OCR: the first pass keeps every pixel up to OCR_MAX_EDGE, the
 * second (only when the first did not add up) enlarges a small photo up to twice. Null when a
 * second pass would read the same pixels again.
 */
export function ocrScale(width: number, height: number, pass: 1 | 2): number | null {
  const long = Math.max(width, height, 1)
  if (pass === 1) return Math.min(1, OCR_MAX_EDGE / long)
  return long < OCR_UPSCALE_EDGE ? Math.min(2, OCR_UPSCALE_EDGE / long) : null
}

/**
 * RGBA pixels to grayscale in place, with the darkest and lightest 1% stretched to black and
 * white: faded thermal print and grey table light come out as dark ink on white paper.
 */
export function stretchGray(pixels: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round((pixels[i]! * 299 + pixels[i + 1]! * 587 + pixels[i + 2]! * 114) / 1000)
    pixels[i] = gray
    histogram[gray]! += 1
  }
  const cut = (pixels.length / 4) * 0.01
  let low = 0
  let high = 255
  for (let v = 0, seen = 0; v < 256; v++) {
    seen += histogram[v]!
    if (seen > cut) {
      low = v
      break
    }
  }
  for (let v = 255, seen = 0; v >= 0; v--) {
    seen += histogram[v]!
    if (seen > cut) {
      high = v
      break
    }
  }
  const span = Math.max(1, high - low)
  for (let i = 0; i < pixels.length; i += 4) {
    const value = ((pixels[i]! - low) * 255) / span
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value
  }
}

/**
 * The copy of a photo the reader sees: from the original file (never the upload JPEG, whose
 * compression smears small print), lossless PNG, grayscale with stretched contrast, scaled by
 * `ocrScale`. A photo the browser cannot decode is read as it is on the first pass.
 */
export async function ocrImage(file: Blob, pass: 1 | 2): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = ocrScale(bitmap.width, bitmap.height, pass)
    if (scale === null) {
      bitmap.close()
      return null
    }
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return pass === 1 ? file : null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const image = context.getImageData(0, 0, width, height)
    stretchGray(image.data)
    context.putImageData(image, 0, 0)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return pass === 1 ? file : null
  }
}

/** Safari decodes HEIC photos; other browsers upload them untouched. */
function canDecodeHeic(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}
