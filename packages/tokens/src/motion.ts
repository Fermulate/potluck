/**
 * Motion tokens. Springs, not linear easing. Shapes match the `motion`
 * library's transition objects so they can be passed straight through.
 */

export interface SpringToken {
  type: 'spring'
  stiffness: number
  damping: number
  mass?: number
}

export const springs = {
  /** The house spring: most UI movement. */
  default: { type: 'spring', stiffness: 380, damping: 32 },
  /** Quick and tight: toggles, pills, tab indicators. */
  snappy: { type: 'spring', stiffness: 520, damping: 38 },
  /** Soft and slower: sheets and large surfaces. */
  gentle: { type: 'spring', stiffness: 260, damping: 30 },
  /** A bit of overshoot: stamps and celebrations. */
  bouncy: { type: 'spring', stiffness: 600, damping: 18, mass: 0.9 },
} as const satisfies Record<string, SpringToken>

/** Durations in ms, for fades and CSS transitions. */
export const durations = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 360,
  countUp: 900,
} as const

/** Cubic bezier curves for the cases where CSS transitions are simpler. */
export const easings = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

/** Delay between list items as they stagger in, in seconds. */
export const STAGGER = 0.03

/** Spinners wait this long before appearing, so fast loads never flash one. */
export const SPINNER_DELAY_MS = 300

/** Distance (px) or velocity (px/s) past which a dragged sheet dismisses. */
export const sheetDismiss = {
  distance: 120,
  velocity: 600,
} as const
