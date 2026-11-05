import { describe, expect, it } from 'vitest'
import { DEFAULT_DOCS_URL, docsOrigin, docsUrl } from './docs'

describe('docs links', () => {
  it('falls back to the public guide', () => {
    expect(docsOrigin(undefined)).toBe(DEFAULT_DOCS_URL)
    expect(docsOrigin('  ')).toBe(DEFAULT_DOCS_URL)
  })

  it('uses a configured guide without its trailing slash', () => {
    expect(docsOrigin('https://help.example.org/')).toBe('https://help.example.org')
    expect(docsUrl('/faq/', docsOrigin('https://help.example.org/'))).toBe(
      'https://help.example.org/faq/',
    )
  })
})
