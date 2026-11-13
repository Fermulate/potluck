import { describe, expect, it } from 'vitest'
import { cleanGuestName, firstName } from '../index'

// Same cases as private.clean_guest_name in supabase/tests/22_guest_links.test.sql.
describe('cleanGuestName', () => {
  it('drops invisible characters and collapses whitespace', () => {
    expect(cleanGuestName('  An\u200Ba\u2069\u00A0\tB\nc\u00AD  ')).toBe('Ana B c')
    expect(cleanGuestName('  An\u200Ba\u2069 ')).toBe('Ana')
  })

  it('leaves nothing of a name made only of invisible characters', () => {
    expect(cleanGuestName('\u200B\u200D\uFEFF \u2066\u3164')).toBe('')
    expect(cleanGuestName('\u{E0041}\u{E0042}\uFE0F')).toBe('')
  })

  it('keeps letters, accents and emoji', () => {
    expect(cleanGuestName('Zo\u00EB \u{1F96F}')).toBe('Zo\u00EB \u{1F96F}')
  })
})

describe('firstName', () => {
  it('takes the first word of a display name', () => {
    expect(firstName('Ava Chen')).toBe('Ava')
    expect(firstName('  Ben   Ortiz ')).toBe('Ben')
    expect(firstName('Cleo')).toBe('Cleo')
    expect(firstName('')).toBe('')
  })
})
