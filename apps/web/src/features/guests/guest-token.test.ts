import { afterEach, describe, expect, it, vi } from 'vitest'
import { readGuestMemory, writeGuestMemory } from './guest-token'

describe('guest memory', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('keeps a token and name per link', () => {
    writeGuestMemory('a', { token: 't-a', name: 'Ana' })
    writeGuestMemory('b', { token: 't-b', name: 'Ben' })
    expect(readGuestMemory('a')).toEqual({ token: 't-a', name: 'Ana' })
    expect(readGuestMemory('b')).toEqual({ token: 't-b', name: 'Ben' })
  })

  it('ignores junk in storage', () => {
    window.localStorage.setItem('potluck.guest.x', '{not json')
    expect(readGuestMemory('x')).toBeNull()
    window.localStorage.setItem('potluck.guest.x', JSON.stringify({ name: 'No token' }))
    expect(readGuestMemory('x')).toBeNull()
    window.localStorage.setItem('potluck.guest.x', JSON.stringify({ token: 't', name: 3 }))
    expect(readGuestMemory('x')).toEqual({ token: 't', name: '' })
  })

  it('carries on when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeGuestMemory('a', { token: 't', name: 'A' })).not.toThrow()
    expect(readGuestMemory('a')).toBeNull()
  })
})
