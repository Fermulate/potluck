/**
 * Expense categories, stored as `expenses.category`. Labels live in `@potluck/i18n`
 * under `categories.<id>`.
 */
export const CATEGORY_IDS = [
  'food',
  'groceries',
  'drinks',
  'transport',
  'gas',
  'lodging',
  'tickets',
  'rent',
  'utilities',
  'shopping',
  'gifts',
  'other',
] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

export interface Category {
  id: CategoryId
  emoji: string
}

const EMOJI: Record<CategoryId, string> = {
  food: '🍝',
  groceries: '🛒',
  drinks: '🍷',
  transport: '🚕',
  gas: '⛽',
  lodging: '🏡',
  tickets: '🎟️',
  rent: '🔑',
  utilities: '💡',
  shopping: '🛍️',
  gifts: '🎁',
  other: '🧾',
}

export const CATEGORIES: readonly Category[] = CATEGORY_IDS.map((id) => ({ id, emoji: EMOJI[id] }))

export function isCategory(value: string | null | undefined): value is CategoryId {
  return value != null && (CATEGORY_IDS as readonly string[]).includes(value)
}

/** Emoji for a stored category, falling back to `other` for unknown or empty values. */
export function categoryEmoji(category: string | null | undefined): string {
  return EMOJI[isCategory(category) ? category : 'other']
}
