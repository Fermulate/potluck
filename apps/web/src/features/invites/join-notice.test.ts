import { describe, expect, it } from 'vitest'
import { inviteUrl } from '@/lib/app-url'
import { inviteCodeFrom, inviteCodeFromPaste } from './join-notice'

const code = 'hikecrew-demo'

describe('inviteCodeFromPaste', () => {
  it('reads the code out of a shared invite link', () => {
    expect(inviteCodeFromPaste(inviteUrl(code))).toBe(code)
    expect(inviteCodeFromPaste(` ${inviteUrl(code)}/ `)).toBe(code)
    expect(inviteCodeFromPaste(`${inviteUrl(code)}?utm=mail#top`)).toBe(code)
  })

  it('accepts a link without the scheme and the bare code', () => {
    expect(inviteCodeFromPaste(`potluck.app/join/${code}`)).toBe(code)
    expect(inviteCodeFromPaste(code)).toBe(code)
  })

  it('rejects anything that is not an invite', () => {
    expect(inviteCodeFromPaste('')).toBeUndefined()
    expect(inviteCodeFromPaste('short')).toBeUndefined()
    expect(inviteCodeFromPaste('https://potluck.app/groups/hikecrew-demo')).toBeUndefined()
    expect(inviteCodeFromPaste('https://evil.example/join/no spaces here')).toBeUndefined()
  })
})

describe('inviteCodeFrom', () => {
  it('only reads codes from a join path', () => {
    expect(inviteCodeFrom(`/join/${code}`)).toBe(code)
    expect(inviteCodeFrom(`/join/${code}?x=1`)).toBe(code)
    expect(inviteCodeFrom(`/groups/${code}`)).toBeUndefined()
    expect(inviteCodeFrom(undefined)).toBeUndefined()
  })
})
