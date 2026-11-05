/** Shape, space, elevation and layering tokens. */

/** Radii in px. */
export const radii = {
  xs: 6,
  sm: 10,
  input: 12,
  card: 18,
  sheet: 28,
  pill: 999,
} as const

/** The spacing grid unit in px. Everything snaps to multiples of 4. */
export const SPACE_UNIT = 4

/** Named spacing steps in px (all multiples of `SPACE_UNIT`). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const

export const layout = {
  /** Mobile gutter. */
  gutter: 16,
  /** Card padding range. */
  cardPadding: 16,
  cardPaddingTight: 12,
  /** Height of the bottom tab bar, excluding the safe area. */
  tabBarHeight: 68,
  /** Width of the desktop side rail. */
  railWidth: 248,
  /** Comfortable reading width for a single column. */
  contentMax: 640,
} as const

/** Borders over shadows: only raised sheets and floating chrome get one. */
export const shadows = {
  light: {
    raised: '0 1px 0 rgba(60, 40, 15, 0.04), 0 10px 30px -14px rgba(80, 45, 10, 0.22)',
    sheet: '0 -1px 0 rgba(60, 40, 15, 0.05), 0 30px 80px -20px rgba(80, 45, 10, 0.35)',
    pop: '0 12px 32px -8px rgba(80, 45, 10, 0.25), 0 2px 6px rgba(80, 45, 10, 0.08)',
  },
  dark: {
    raised: '0 1px 0 rgba(255, 240, 220, 0.03), 0 12px 30px -14px rgba(0, 0, 0, 0.7)',
    sheet: '0 -1px 0 rgba(255, 240, 220, 0.05), 0 30px 80px -20px rgba(0, 0, 0, 0.8)',
    pop: '0 12px 32px -8px rgba(0, 0, 0, 0.7), 0 2px 6px rgba(0, 0, 0, 0.4)',
  },
} as const

export type ShadowName = keyof (typeof shadows)['light']

export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 20,
  nav: 30,
  overlay: 40,
  sheet: 50,
  popover: 60,
  toast: 70,
  tooltip: 80,
} as const

/** Min-width breakpoints in px. Mobile first. */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const

export type Breakpoint = keyof typeof breakpoints
