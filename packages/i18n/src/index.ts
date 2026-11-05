/**
 * Translation strings and lookup. Platform-neutral.
 */
export const en = {
  'app.name': 'Potluck',
} as const

export type MessageKey = keyof typeof en

export function t(key: MessageKey): string {
  return en[key]
}
