/**
 * Design tokens shared by web and mobile. Plain values only, no CSS or DOM.
 */
export const colors = {
  ink: '#1d1a16',
  cream: '#fbf5ea',
} as const

export type ColorToken = keyof typeof colors
