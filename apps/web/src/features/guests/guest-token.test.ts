import { afterEach, describe, expect, it, vi } from 'vitest'
import { guestMemory } from './guest-token'

describe('guest memory', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('keeps a token and name per link', () => {
    guestMemory.write('a', { token: 't-a', name: 'Ana' })
    guestMemory.write('b', { token: 't-b', name: 'Ben' })
    expect(guestMemory.read('a')).toEqual({ token: 't-a', name: 'Ana' })
    expect(guestMemory.read('b')).toEqual({ token: 't-b', name: 'Ben' })
  })

  it('ignores junk in storage', () => {
    window.localStorage.setItem('potluck.guest.x', '{not json')
    expect(guestMemory.read('x')).toBeNull()
    window.localStorage.setItem('potluck.guest.x', JSON.stringify({ name: 'No token' }))
    expect(guestMemory.read('x')).toBeNull()
    window.localStorage.setItem('potluck.guest.x', JSON.stringify({ token: 't', name: 3 }))
    expect(guestMemory.read('x')).toEqual({ token: 't', name: '' })
  })

  it('forgets a link', () => {
    guestMemory.write('a', { token: 't-a', name: 'Ana' })
    guestMemory.forget('a')
    expect(guestMemory.read('a')).toBeNull()
  })

  it('carries on when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => guestMemory.write('a', { token: 't', name: 'A' })).not.toThrow()
    expect(() => guestMemory.forget('a')).not.toThrow()
    expect(guestMemory.read('a')).toBeNull()
  })
})
