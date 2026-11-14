import { afterEach, describe, expect, it, vi } from 'vitest'
import { newRequestId } from './request-id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newRequestId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is a fresh version 4 uuid each time', () => {
    const a = newRequestId()
    expect(a).toMatch(UUID_V4)
    expect(newRequestId()).not.toBe(a)
  })

  it('builds one from random bytes where randomUUID is missing (no secure context)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff),
    })
    expect(newRequestId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })
})
