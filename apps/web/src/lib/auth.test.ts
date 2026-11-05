import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { needsOnboarding, safeRedirect } from './auth'

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

describe('needsOnboarding', () => {
  const session = (user_metadata: Record<string, unknown>) =>
    ({ user: { id: 'u-1', user_metadata } }) as unknown as Session

  it('sends every new account through onboarding, whatever the sign in method', () => {
    expect(needsOnboarding(session({}))).toBe(true)
    expect(needsOnboarding(session({ full_name: 'Ava Chen', avatar_url: 'https://x/a.png' }))).toBe(
      true,
    )
    expect(needsOnboarding(session({ display_name: 'Ava', timezone: 'UTC' }))).toBe(true)
  })

  it('stops once the profile has been saved', () => {
    expect(needsOnboarding(session({ onboarded: true }))).toBe(false)
    expect(needsOnboarding(session({ onboarded: 'true' }))).toBe(true)
  })

  it('is false without a session', () => {
    expect(needsOnboarding(null)).toBe(false)
  })
})
