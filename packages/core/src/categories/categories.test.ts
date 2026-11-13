import { describe, expect, it } from 'vitest'
import {
  ALL_CATEGORY_IDS,
  CATEGORIES,
  SUBCATEGORIES,
  categoryEmoji,
  isCategory,
  isSubcategory,
  parentCategory,
  expenseCreateSchema,
  subcategoriesOf,
} from '../index'

describe('categories', () => {
  it('lists the top level categories in display order, ending with other', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
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
    ])
  })

  it('keeps every id stored before subcategories existed', () => {
    for (const id of [
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
    ]) {
      expect(isCategory(id)).toBe(true)
      expect(parentCategory(id)).toBe(id)
    }
  })

  it('gives every category and subcategory its own emoji and id', () => {
    const emoji = [...CATEGORIES, ...SUBCATEGORIES].map((c) => c.emoji)
    expect(new Set(emoji).size).toBe(emoji.length)
    expect(new Set(ALL_CATEGORY_IDS).size).toBe(ALL_CATEGORY_IDS.length)
    expect(emoji.every((e) => e.length > 0)).toBe(true)
  })

  it('fits every id in the 40 characters expenses.category allows', () => {
    expect(ALL_CATEGORY_IDS.every((id) => id.length <= 40)).toBe(true)
  })

  it('rolls subcategories up to their parent', () => {
    expect(parentCategory('taxi')).toBe('transport')
    expect(parentCategory('coffee')).toBe('food')
    expect(parentCategory('electricity')).toBe('utilities')
    expect(parentCategory('mystery')).toBe('other')
    expect(parentCategory(null)).toBe('other')
  })

  it('lists the subcategories under a parent, and none under a plain one', () => {
    expect(subcategoriesOf('transport').map((s) => s.id)).toEqual([
      'taxi',
      'public_transit',
      'flights',
      'car_rental',
      'parking',
      'tolls',
      'bike',
      'ferry',
    ])
    expect(subcategoriesOf('groceries')).toEqual([])
    expect(SUBCATEGORIES.every((s) => subcategoriesOf(s.parent).includes(s))).toBe(true)
  })

  it('looks up emoji, falling back to other for unknown or missing categories', () => {
    expect(categoryEmoji('food')).toBe('🍝')
    expect(categoryEmoji('taxi')).toBe('🚖')
    expect(categoryEmoji('mystery')).toBe(categoryEmoji('other'))
    expect(categoryEmoji(null)).toBe(categoryEmoji('other'))
  })

  it('narrows strings to category ids', () => {
    expect(isCategory('drinks')).toBe(true)
    expect(isCategory('wine_spirits')).toBe(true)
    expect(isCategory('Drinks')).toBe(false)
    expect(isCategory('toString')).toBe(false)
    expect(isCategory(undefined)).toBe(false)
    expect(isSubcategory('taxi')).toBe(true)
    expect(isSubcategory('transport')).toBe(false)
    expect(isSubcategory(null)).toBe(false)
  })

  it('accepts subcategories in an expense payload', () => {
    const a = '6f1c1d1e-9a0b-4c55-8d7e-1a2b3c4d5e6f'
    const parsed = expenseCreateSchema.safeParse({
      group_id: 'a8f5f167-f44f-4964-b6c2-3b9f1e2d7c4a',
      description: 'Uber',
      amount_cents: 1200,
      currency: 'EUR',
      paid_by: a,
      split_type: 'equal',
      splits: [{ user_id: a, share_cents: 1200 }],
      category: 'taxi',
      spent_at: '2026-11-13',
    })
    expect(parsed.success && parsed.data.category).toBe('taxi')
  })
})
