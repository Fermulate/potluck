import { describe, expect, it } from 'vitest'
import { directFriendId, groupDisplayName } from '../index'

const names: Record<string, string> = { me: 'Pat', jules: 'Jules Park' }
const nameOf = (id: string) => names[id]

describe('groupDisplayName', () => {
  it('keeps the name of a group', () => {
    const trip = { name: 'Lisbon', isDirect: false, memberIds: ['me', 'jules'] }
    expect(groupDisplayName(trip, 'me', nameOf, 'One-on-one')).toBe('Lisbon')
    expect(directFriendId(trip, 'me')).toBeNull()
  })

  it('names a one-on-one tab after the other person, never its stored name', () => {
    const tab = { name: 'Direct', isDirect: true, memberIds: ['me', 'jules'] }
    expect(directFriendId(tab, 'me')).toBe('jules')
    expect(groupDisplayName(tab, 'me', nameOf, 'One-on-one')).toBe('Jules Park')
    expect(groupDisplayName(tab, 'jules', nameOf, 'One-on-one')).toBe('Pat')
  })

  it('falls back when the other person is unknown', () => {
    const alone = { name: 'Direct', isDirect: true, memberIds: ['me'] }
    expect(groupDisplayName(alone, 'me', nameOf, 'One-on-one')).toBe('One-on-one')
    const stranger = { name: 'Direct', isDirect: true, memberIds: ['me', 'gone'] }
    expect(groupDisplayName(stranger, 'me', nameOf, 'One-on-one')).toBe('One-on-one')
  })
})
