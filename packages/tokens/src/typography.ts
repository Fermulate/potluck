/**
 * Type tokens. Sizes are in rem so they follow the user's font size setting.
 * The scale follows the classic typographic ladder (12, 14, 16, 18, 21, 24,
 * 36, 48, 60, 72, 96).
 */

export const fontFamily = {
  /** Display serif, italic for flourishes. */
  display: "'Instrument Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  /** UI grotesque, variable 200 to 800. */
  sans: "'Bricolage Grotesque Variable', 'Bricolage Grotesque', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 800,
} as const

export interface TypeStep {
  /** Font size in rem. */
  size: number
  /** Unitless line height. */
  lineHeight: number
  /** Letter spacing in em. */
  tracking: number
}

export const typeScale = {
  xs: { size: 0.75, lineHeight: 1.35, tracking: 0.01 },
  sm: { size: 0.875, lineHeight: 1.4, tracking: 0 },
  base: { size: 1, lineHeight: 1.5, tracking: 0 },
  lg: { size: 1.125, lineHeight: 1.45, tracking: -0.005 },
  xl: { size: 1.3125, lineHeight: 1.3, tracking: -0.01 },
  '2xl': { size: 1.5, lineHeight: 1.2, tracking: -0.015 },
  '3xl': { size: 2.25, lineHeight: 1.08, tracking: -0.02 },
  '4xl': { size: 3, lineHeight: 1, tracking: -0.025 },
  '5xl': { size: 3.75, lineHeight: 0.98, tracking: -0.03 },
  '6xl': { size: 4.5, lineHeight: 0.95, tracking: -0.035 },
  '7xl': { size: 6, lineHeight: 0.9, tracking: -0.04 },
} as const satisfies Record<string, TypeStep>

export type TypeStepName = keyof typeof typeScale
