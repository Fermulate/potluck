import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryEmoji, isCategory } from '../index'

describe('categories', () => {
  it('lists the expense categories in display order, ending with other', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
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
    ])
  })

  it('gives every category a distinct emoji', () => {
    const emoji = CATEGORIES.map((c) => c.emoji)
    expect(new Set(emoji).size).toBe(CATEGORIES.length)
    expect(emoji.every((e) => e.length > 0)).toBe(true)
  })

  it('looks up emoji, falling back to other for unknown or missing categories', () => {
    expect(categoryEmoji('food')).toBe('🍝')
    expect(categoryEmoji('mystery')).toBe(categoryEmoji('other'))
    expect(categoryEmoji(null)).toBe(categoryEmoji('other'))
  })

  it('narrows strings to category ids', () => {
    expect(isCategory('drinks')).toBe(true)
    expect(isCategory('Drinks')).toBe(false)
    expect(isCategory(undefined)).toBe(false)
  })
})
