import { describe, expect, it } from 'vitest'
import { inviteCreateSchema, settleUpSchema } from '../index'

const GROUP = 'a8f5f167-f44f-4964-b6c2-3b9f1e2d7c4a'
const BOB = '0b2e7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

describe('settleUpSchema', () => {
  const valid = { group_id: GROUP, to_user: BOB, amount_cents: 1250, currency: 'EUR' }

  it('accepts a settle-up and normalizes a blank note to null', () => {
    expect(settleUpSchema.parse({ ...valid, note: '  ' })).toEqual({ ...valid, note: null })
    expect(settleUpSchema.parse({ ...valid, note: ' thanks! ' }).note).toBe('thanks!')
  })

  it.each([
    ['zero amount', { amount_cents: 0 }],
    ['negative amount', { amount_cents: -5 }],
    ['bad recipient', { to_user: 'bob' }],
    ['long note', { note: 'x'.repeat(281) }],
    ['bad currency', { currency: 'EURO' }],
  ])('rejects %s', (_label, patch) => {
    expect(settleUpSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
})

describe('inviteCreateSchema', () => {
  it('defaults to an unlimited member invite', () => {
    expect(inviteCreateSchema.parse({ group_id: GROUP })).toEqual({
      group_id: GROUP,
      role: 'member',
      max_uses: null,
      expires_at: null,
      email: null,
    })
  })

  it('accepts limits, expiry and an email', () => {
    expect(
      inviteCreateSchema.parse({
        group_id: GROUP,
        role: 'admin',
        max_uses: 5,
        expires_at: '2026-12-01T00:00:00Z',
        email: ' Sam@Example.com ',
      }),
    ).toMatchObject({ role: 'admin', max_uses: 5, email: 'sam@example.com' })
  })

  it.each([
    ['owner role', { role: 'owner' }],
    ['zero uses', { max_uses: 0 }],
    ['bad email', { email: 'not-an-email' }],
    ['bad expiry', { expires_at: 'tomorrow' }],
  ])('rejects %s', (_label, patch) => {
    expect(inviteCreateSchema.safeParse({ group_id: GROUP, ...patch }).success).toBe(false)
  })
})
