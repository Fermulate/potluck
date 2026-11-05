import { describe, expect, it } from 'vitest'
import { safeRedirect } from './auth'

describe('safeRedirect', () => {
  it('keeps same-origin paths, including search', () => {
    expect(safeRedirect('/join/hikecrew-demo')).toBe('/join/hikecrew-demo')
    expect(safeRedirect('/groups?new=true')).toBe('/groups?new=true')
  })

  it('refuses anything that could leave the site', () => {
    expect(safeRedirect('https://evil.example')).toBe('/home')
    expect(safeRedirect('//evil.example')).toBe('/home')
    expect(safeRedirect('/\\evil.example')).toBe('/home')
    expect(safeRedirect(undefined, '/welcome')).toBe('/welcome')
  })
})
