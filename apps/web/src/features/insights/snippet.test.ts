import { describe, expect, it } from 'vitest'
import { snippetParts } from './snippet'

const plain = (text: string, query: string, width?: number) => {
  const { before, match, after } = snippetParts(text, query, width)
  return `${before}${match}${after}`
}

const long =
  'We grabbed coffee on the way up and then the whole group stopped at the market for supplies, ' +
  'and Ben insisted on the spicy salsa from the stall by the bridge before we drove back home.'

describe('snippetParts', () => {
  it('keeps short text whole', () => {
    expect(plain('  Remember   the salsa ', 'salsa')).toBe('Remember the salsa')
  })

  it('centers a long text on the match, cut at spaces', () => {
    const piece = plain(long, 'SALSA', 60)
    expect(piece.startsWith('…')).toBe(true)
    expect(piece.endsWith('…')).toBe(true)
    expect(piece.toLowerCase()).toContain('salsa')
    expect(piece.length).toBeLessThanOrEqual(62)
  })

  it('starts at the beginning when the match is near it', () => {
    expect(plain(long, 'coffee', 40)).toMatch(/^We grabbed coffee.*…$/)
  })

  it('ends at the end when the match is near it', () => {
    expect(plain(long, 'home', 40)).toMatch(/^….*home\.$/)
  })

  it('falls back to the opening when the match is not in the text', () => {
    expect(plain(long, 'zebra', 20)).toBe('We grabbed coffee on…')
    expect(plain(long, '', 20)).toBe('We grabbed coffee on…')
  })

  it('splits out the match so it can be marked, keeping its own letters', () => {
    const parts = snippetParts(long, 'SPICY SALSA')
    expect(parts.match).toBe('spicy salsa')
    expect(parts.before.startsWith('\u2026')).toBe(true)
    expect(parts.after.endsWith('\u2026')).toBe(true)
    expect(`${parts.before}${parts.match}${parts.after}`.length).toBeLessThanOrEqual(58)
    expect(snippetParts('Short one', 'zebra')).toEqual({
      before: 'Short one',
      match: '',
      after: '',
    })
  })
})
