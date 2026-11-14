import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isCategory, normalizeDescription, parentCategory, suggestCategory } from '../index'

const top = (description: string) => {
  const s = suggestCategory(description)
  return s && parentCategory(s.category)
}

describe('normalizeDescription', () => {
  it('drops case, accents, punctuation and extra spaces', () => {
    expect(normalizeDescription('  Café   Nero! ')).toBe('cafe nero')
    expect(normalizeDescription('Frühstück & Brötchen')).toBe('fruhstuck brotchen')
    expect(normalizeDescription('Straße')).toBe('strasse')
    expect(normalizeDescription('H&M')).toBe('h m')
    expect(normalizeDescription('!!!')).toBe('')
  })
})

describe('suggestCategory', () => {
  it('suggests Transport for "Uber", as a taxi', () => {
    expect(suggestCategory('Uber')).toEqual({ category: 'taxi', from: 'keyword' })
    expect(top('uber to the airport')).toBe('transport')
  })

  it('reads the categories people type most', () => {
    expect(suggestCategory('Groceries at Lidl')?.category).toBe('groceries')
    expect(suggestCategory('Rent for March')?.category).toBe('rent')
    expect(suggestCategory('Electricity bill')?.category).toBe('electricity')
    expect(suggestCategory('Airbnb Lisbon')?.category).toBe('vacation_rental')
    expect(suggestCategory('Flights to Rome')?.category).toBe('flights')
    expect(suggestCategory('Pizza night')?.category).toBe('dining_out')
    expect(suggestCategory('Concert tickets')?.category).toBe('concerts')
    expect(suggestCategory('Netflix')?.category).toBe('entertainment')
  })

  it('reads store names written with or without their apostrophe', () => {
    expect(suggestCategory("Trader Joe's")?.category).toBe('groceries')
    expect(suggestCategory('trader joes run')?.category).toBe('groceries')
    expect(suggestCategory("Sainsbury's")?.category).toBe('groceries')
    expect(suggestCategory('Sainsburys')?.category).toBe('groceries')
  })

  it('does not read everyday English words as a foreign keyword or a brand', () => {
    expect(suggestCategory('Online courses')?.category).toBe('education')
    // French shopping and English classes share a word, so on its own it suggests nothing.
    expect(suggestCategory('Courses')).toBeNull()
    expect(suggestCategory('Courses Carrefour')?.category).toBe('groceries')
    expect(top('Grab lunch with Sam')).not.toBe('transport')
    expect(suggestCategory('Faire les courses')?.category).toBe('groceries')
    expect(suggestCategory('GrabCar to the hotel')?.category).toBe('taxi')
  })

  it('prefers a longer phrase over one of its words', () => {
    expect(suggestCategory('Uber Eats')?.category).toBe('takeout')
    expect(suggestCategory('gas bill')?.category).toBe('heating')
    expect(suggestCategory('gas')?.category).toBe('gas')
    expect(suggestCategory('Rent a car in Faro')?.category).toBe('car_rental')
  })

  it('takes the earliest word when two of the same length match', () => {
    expect(suggestCategory('coffee and cake at the bakery')?.category).toBe('coffee')
  })

  it('matches whole words only', () => {
    expect(suggestCategory('Business lunch')?.category).toBe('dining_out')
    expect(suggestCategory('Rental deposit')).toBeNull()
    expect(suggestCategory('Barbecue')).toBeNull()
  })

  it('understands the other languages Potluck speaks', () => {
    expect(suggestCategory('Café con leche')?.category).toBe('coffee')
    expect(suggestCategory('Supermercado')?.category).toBe('groceries')
    expect(suggestCategory('Loyer novembre')?.category).toBe('rent')
    expect(suggestCategory('Abendessen')?.category).toBe('dining_out')
    expect(suggestCategory('Gasolina')?.category).toBe('gas')
  })

  it('suggests nothing for an empty or unknown description', () => {
    expect(suggestCategory('')).toBeNull()
    expect(suggestCategory('   ')).toBeNull()
    expect(suggestCategory('Zxqv')).toBeNull()
  })

  describe('with the group history', () => {
    const history = [
      { description: 'Uber', category: 'other' },
      { description: 'Sunday roast', category: 'food' },
      { description: 'Sunday roast', category: 'groceries' },
      { description: 'Something odd', category: 'crypto' },
      { description: 'Mystery box', category: null },
    ]

    it('suggests the category of a description used before, newest first', () => {
      expect(suggestCategory('sunday roast', history)).toEqual({
        category: 'food',
        from: 'history',
      })
    })

    it('lets the group habit beat the keyword list', () => {
      expect(suggestCategory('UBER', history)).toEqual({ category: 'other', from: 'history' })
    })

    it('falls back to a distinctive word shared with an earlier expense', () => {
      expect(suggestCategory('Roast for six', history)).toEqual({
        category: 'food',
        from: 'history',
      })
    })

    it('ignores categories Potluck does not know and short filler words', () => {
      expect(suggestCategory('Something odd', history)).toBeNull()
      expect(suggestCategory('Mystery box', history)).toBeNull()
      expect(
        suggestCategory('the for', [{ description: 'the for', category: 'crypto' }]),
      ).toBeNull()
      expect(
        suggestCategory('with', [{ description: 'with friends', category: 'food' }]),
      ).toBeNull()
    })
  })

  it('always returns a known category, or nothing', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const s = suggestCategory(text)
        return s === null || isCategory(s.category)
      }),
    )
  })
})
