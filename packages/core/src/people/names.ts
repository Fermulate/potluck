/** First word of a display name ("Ava" for " Ava Chen"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

// Invisible and zero width characters: soft hyphen, combining grapheme joiner, Arabic letter mark,
// Hangul fillers, Khmer and Mongolian invisibles, zero width space and joiners, direction marks
// and embeddings, word joiner and invisible operators, variation selectors, the BOM, musical
// symbol format characters and tag characters. Same list as private.clean_guest_name.
const INVISIBLE =
  // Each one is matched on its own on purpose, combining marks included.
  // eslint-disable-next-line no-misleading-character-class
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]/gu
// eslint-disable-next-line no-control-regex
const SPACING = /[\s\u0001-\u001F\u007F-\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu

/**
 * A guest's name made safe to show, like `private.clean_guest_name`: invisible characters
 * dropped, whitespace and control runs collapsed to one space, ends trimmed. Check the length
 * (1 to 40) on the result.
 */
export function cleanGuestName(name: string): string {
  return name.replace(INVISIBLE, '').replace(SPACING, ' ').trim()
}
