/**
 * Color tokens. "Paper and ink, a splash of tomato and saffron."
 *
 * Each theme exposes the same semantic keys so components never branch on
 * the theme. `*Ink` variants are the text-safe versions of a hue (AA on
 * paper and card), `*Soft` variants are tinted backgrounds, `on*` is the
 * foreground to use on a solid fill of that hue.
 */

/** Raw brand hues from docs/design.md, useful for illustrations and confetti. */
export const palette = {
  paper: '#fbf5ea',
  card: '#ffffff',
  ink: '#1d1a16',
  mute: '#7a7166',
  line: '#ebe2d3',
  tomato: '#e8492f',
  saffron: '#f5b53d',
  olive: '#5f7a3a',
  plum: '#6b3d6e',
} as const

export interface ThemeColors {
  /** App background. */
  paper: string
  /** Raised surface (cards, sheets). */
  card: string
  /** Recessed surface (inputs, segmented tracks, pressed rows). */
  sunken: string
  /** Primary text and dark surfaces. */
  ink: string
  /** Secondary text. AA on paper and card. */
  mute: string
  /** Hairline borders and dividers. */
  line: string
  /** Stronger borders (inputs, hover). */
  lineStrong: string

  tomato: string
  /** Solid fill for primary buttons, AA with `onTomato`. */
  tomatoStrong: string
  tomatoInk: string
  tomatoSoft: string
  onTomato: string

  saffron: string
  saffronInk: string
  saffronSoft: string
  onSaffron: string

  olive: string
  oliveInk: string
  oliveSoft: string
  onOlive: string

  plum: string
  plumInk: string
  plumSoft: string
  onPlum: string

  /** The balance hero surface and its foregrounds. */
  hero: string
  onHero: string
  heroMute: string

  /** Focus ring color. */
  focus: string
  /** Modal scrim. */
  scrim: string
}

export const lightColors: ThemeColors = {
  paper: '#fbf5ea',
  card: '#ffffff',
  sunken: '#f4ecde',
  ink: '#1d1a16',
  // Nudged from #7a7166 so secondary text passes AA on paper.
  mute: '#716759',
  line: '#ebe2d3',
  lineStrong: '#d8cab3',

  tomato: '#e8492f',
  tomatoStrong: '#d63f25',
  tomatoInk: '#bc3720',
  tomatoSoft: '#fde4da',
  onTomato: '#ffffff',

  saffron: '#f5b53d',
  saffronInk: '#8f5c00',
  saffronSoft: '#fdf0d4',
  onSaffron: '#1d1a16',

  olive: '#5f7a3a',
  oliveInk: '#4f6a2c',
  oliveSoft: '#e9eedd',
  onOlive: '#ffffff',

  plum: '#6b3d6e',
  plumInk: '#6b3d6e',
  plumSoft: '#f1e4ef',
  onPlum: '#ffffff',

  hero: '#1d1a16',
  onHero: '#fbf5ea',
  heroMute: '#b9ad9c',

  focus: '#1d1a16',
  scrim: 'rgba(29, 26, 22, 0.42)',
}

export const darkColors: ThemeColors = {
  paper: '#14110e',
  card: '#1f1b17',
  sunken: '#1a1613',
  ink: '#f6efe3',
  mute: '#a89d8f',
  line: '#322b24',
  lineStrong: '#4a4037',

  tomato: '#ff6a4d',
  tomatoStrong: '#ff6a4d',
  tomatoInk: '#ff8a70',
  tomatoSoft: '#3b1f18',
  onTomato: '#1d1a16',

  saffron: '#ffc65c',
  saffronInk: '#ffc65c',
  saffronSoft: '#382c15',
  onSaffron: '#14110e',

  olive: '#8fb062',
  oliveInk: '#a6c47c',
  oliveSoft: '#222a18',
  onOlive: '#14110e',

  plum: '#c79bd0',
  plumInk: '#d6b3dc',
  plumSoft: '#2d2030',
  onPlum: '#14110e',

  // In the dark the hero turns into a lit paper slip rather than a black slab.
  hero: '#f3e9d8',
  onHero: '#1d1a16',
  heroMute: '#6c6152',

  focus: '#f6efe3',
  scrim: 'rgba(5, 4, 3, 0.62)',
}

/**
 * Availability heat, 0 (nobody) to 4 (everyone). Index with
 * `heatLevel(count, max)`.
 */
export const heat = {
  light: ['#f1e9db', '#f9dccf', '#f4ab95', '#ee7a5d', '#e8492f'],
  dark: ['#26201b', '#4a2a21', '#7e3828', '#c44a31', '#ff6a4d'],
} as const satisfies Record<'light' | 'dark', readonly string[]>

export const HEAT_STEPS = 5

/** Maps a count to a heat step (0 to 4). Zero always maps to 0, the max to 4. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (max <= 0 || count <= 0) return 0
  const ratio = Math.min(count / max, 1)
  return Math.max(1, Math.ceil(ratio * (HEAT_STEPS - 1))) as 1 | 2 | 3 | 4
}

/**
 * Avatar fills, picked deterministically from a seed (user id). Every pair is
 * AA for bold initials.
 */
export const avatarPalette = [
  { bg: '#f5b53d', fg: '#1d1a16' },
  { bg: '#6b3d6e', fg: '#ffffff' },
  { bg: '#5f7a3a', fg: '#ffffff' },
  { bg: '#d63f25', fg: '#ffffff' },
  { bg: '#2f5d6b', fg: '#ffffff' },
  { bg: '#e9b8a6', fg: '#1d1a16' },
  { bg: '#1d1a16', fg: '#fbf5ea' },
  { bg: '#c9d6a8', fg: '#1d1a16' },
] as const

/** Small, stable string hash (FNV-1a). */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function avatarColor(seed: string): (typeof avatarPalette)[number] {
  return avatarPalette[hashString(seed) % avatarPalette.length]!
}

/** Confetti and celebration colors. */
export const celebration = [
  '#e8492f',
  '#f5b53d',
  '#5f7a3a',
  '#6b3d6e',
  '#fbf5ea',
  '#ff8a70',
] as const

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of a `#rrggbb` color (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
