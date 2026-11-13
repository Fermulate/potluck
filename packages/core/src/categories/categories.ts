/**
 * Expense categories, stored as `expenses.category`. Labels live in `@potluck/i18n` under
 * `categories.<id>` (top level) and `categories.sub.<id>` (subcategories).
 *
 * A subcategory is stored by its own id (`taxi`, not `transport.taxi`), so every value saved
 * before subcategories existed is still a valid top level id. Ids are unique across both levels;
 * `parentCategory()` rolls a subcategory up for totals and charts.
 */
export const CATEGORY_IDS = [
  'food',
  'groceries',
  'drinks',
  'transport',
  'gas',
  'lodging',
  'tickets',
  'entertainment',
  'rent',
  'utilities',
  'home',
  'shopping',
  'gifts',
  'health',
  'life',
  'other',
] as const

export type TopCategoryId = (typeof CATEGORY_IDS)[number]

const SUBCATEGORY_TREE = {
  food: ['dining_out', 'takeout', 'coffee', 'snacks'],
  drinks: ['bar', 'wine_spirits'],
  transport: [
    'taxi',
    'public_transit',
    'flights',
    'car_rental',
    'parking',
    'tolls',
    'bike',
    'ferry',
  ],
  gas: ['ev_charging'],
  lodging: ['hotel', 'vacation_rental', 'camping'],
  entertainment: ['movies', 'concerts', 'games', 'sports'],
  rent: ['mortgage'],
  utilities: ['electricity', 'heating', 'water', 'internet', 'phone', 'trash', 'cleaning'],
  home: ['furniture', 'household_supplies', 'maintenance', 'electronics', 'pets', 'services'],
  shopping: ['clothing'],
  health: ['medical', 'pharmacy', 'fitness'],
  life: ['childcare', 'education', 'insurance', 'taxes'],
} as const satisfies Partial<Record<TopCategoryId, readonly string[]>>

type Tree = typeof SUBCATEGORY_TREE
export type SubcategoryId = Tree[keyof Tree][number]

/** Every storable id: the top level ones, then every subcategory. */
export type CategoryId = TopCategoryId | SubcategoryId

export const SUBCATEGORY_IDS: readonly SubcategoryId[] = Object.values(SUBCATEGORY_TREE).flat()

export const ALL_CATEGORY_IDS = [...CATEGORY_IDS, ...SUBCATEGORY_IDS] as [
  CategoryId,
  ...CategoryId[],
]

export interface Category {
  id: TopCategoryId
  emoji: string
}

export interface Subcategory {
  id: SubcategoryId
  parent: TopCategoryId
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
  entertainment: '🎭',
  rent: '🔑',
  utilities: '💡',
  home: '🏠',
  shopping: '🛍️',
  gifts: '🎁',
  health: '🩺',
  life: '🌱',
  other: '🧾',
  dining_out: '🍽️',
  takeout: '🥡',
  coffee: '☕',
  snacks: '🥨',
  bar: '🍸',
  wine_spirits: '🍾',
  taxi: '🚖',
  public_transit: '🚆',
  flights: '✈️',
  car_rental: '🚗',
  parking: '🅿️',
  tolls: '🛣️',
  bike: '🚲',
  ferry: '⛴️',
  ev_charging: '🔋',
  hotel: '🏨',
  vacation_rental: '🏘️',
  camping: '🏕️',
  movies: '🎬',
  concerts: '🎤',
  games: '🎮',
  sports: '⚽',
  mortgage: '🏦',
  electricity: '⚡',
  heating: '🔥',
  water: '🚰',
  internet: '📶',
  phone: '📱',
  trash: '🗑️',
  cleaning: '🧽',
  furniture: '🪑',
  household_supplies: '🧻',
  maintenance: '🛠️',
  electronics: '💻',
  pets: '🐾',
  services: '🧰',
  clothing: '👕',
  medical: '🏥',
  pharmacy: '💊',
  fitness: '🏋️',
  childcare: '🧸',
  education: '📚',
  insurance: '🛡️',
  taxes: '🧮',
}

const PARENT = new Map<string, TopCategoryId>(
  Object.entries(SUBCATEGORY_TREE).flatMap(([parent, subs]) =>
    subs.map((sub) => [sub, parent as TopCategoryId] as const),
  ),
)

export const CATEGORIES: readonly Category[] = CATEGORY_IDS.map((id) => ({ id, emoji: EMOJI[id] }))

export const SUBCATEGORIES: readonly Subcategory[] = SUBCATEGORY_IDS.map((id) => ({
  id,
  parent: PARENT.get(id)!,
  emoji: EMOJI[id],
}))

/** True for any storable id, top level or subcategory. */
export function isCategory(value: string | null | undefined): value is CategoryId {
  return value != null && Object.prototype.hasOwnProperty.call(EMOJI, value)
}

export function isSubcategory(value: string | null | undefined): value is SubcategoryId {
  return value != null && PARENT.has(value)
}

/** The top level category a stored value rolls up to; unknown or empty values are `other`. */
export function parentCategory(category: string | null | undefined): TopCategoryId {
  if (!isCategory(category)) return 'other'
  return PARENT.get(category) ?? (category as TopCategoryId)
}

/** The subcategories under a top level category, in display order. */
export function subcategoriesOf(parent: TopCategoryId): readonly Subcategory[] {
  return SUBCATEGORIES.filter((s) => s.parent === parent)
}

/** Emoji for a stored category, falling back to `other` for unknown or empty values. */
export function categoryEmoji(category: string | null | undefined): string {
  return EMOJI[isCategory(category) ? category : 'other']
}
