import { describe, expect, it } from 'vitest'
import { asciiLower, friendInviteSchema, isPlainEmail, placeholderSchema } from '../index'

describe('placeholderSchema', () => {
  it('trims the name and lower cases the email, like add_placeholder_member', () => {
    expect(placeholderSchema.parse({ display_name: ' Sam ', email: ' Sam@Example.com ' })).toEqual({
      display_name: 'Sam',
      email: 'sam@example.com',
    })
  })

  it('treats a missing or blank email as none', () => {
    expect(placeholderSchema.parse({ display_name: 'Sam' }).email).toBeNull()
    expect(placeholderSchema.parse({ display_name: 'Sam', email: '   ' }).email).toBeNull()
    expect(placeholderSchema.parse({ display_name: 'Sam', email: null }).email).toBeNull()
  })

  it('counts a name in characters, as Postgres char_length does', () => {
    const taco = '\u{1F32E}'
    expect(placeholderSchema.safeParse({ display_name: taco.repeat(80) }).success).toBe(true)
    expect(placeholderSchema.safeParse({ display_name: taco.repeat(81) }).success).toBe(false)
  })

  it.each([
    ['a blank name', { display_name: '   ' }],
    ['a long name', { display_name: 'x'.repeat(81) }],
    ['a bad email', { display_name: 'Sam', email: 'not an email' }],
  ])('rejects %s', (_label, input) => {
    expect(placeholderSchema.safeParse(input).success).toBe(false)
  })
})

describe('friendInviteSchema', () => {
  it('needs an email', () => {
    expect(friendInviteSchema.parse({ email: ' Cleo@Example.com' })).toEqual({
      email: 'cleo@example.com',
    })
    expect(friendInviteSchema.safeParse({ email: '' }).success).toBe(false)
  })
})

describe('plain emails, like private.is_plain_email and private.ascii_lower', () => {
  it('lower cases only A to Z', () => {
    expect(asciiLower('Sam.LEE@Example.COM')).toBe('sam.lee@example.com')
    expect(asciiLower('Émile')).toBe('Émile')
  })

  it('accepts printable ASCII with one @ and a dot after it', () => {
    expect(isPlainEmail('sam@example.com')).toBe(true)
    expect(isPlainEmail('sám@example.com')).toBe(false)
    expect(isPlainEmail('sam@localhost')).toBe(false)
    expect(isPlainEmail('sam @example.com')).toBe(false)
    expect(isPlainEmail(`${'a'.repeat(250)}@b.co`)).toBe(false)
  })

  it('refuses a non ASCII seat email', () => {
    expect(
      placeholderSchema.safeParse({ display_name: 'Sam', email: 'sám@example.com' }).success,
    ).toBe(false)
  })
})
