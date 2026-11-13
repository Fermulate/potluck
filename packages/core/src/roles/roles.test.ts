import { describe, expect, it } from 'vitest'
import { can, type GroupRole } from '../index'

const roles: GroupRole[] = ['owner', 'admin', 'member']
const everyone = (check: (role: GroupRole) => boolean) => roles.map(check)

describe('can', () => {
  it('lets everyone add expenses, events, availability, RSVPs and comments', () => {
    for (const action of [
      'expense.create',
      'event.create',
      'availability.set',
      'availability.request',
      'rsvp.set',
      'comment.create',
    ] as const) {
      expect(everyone((r) => can(r, action))).toEqual([true, true, true])
    }
  })

  it('lets everyone edit and delete their own expenses', () => {
    expect(everyone((r) => can(r, 'expense.edit', { isOwn: true }))).toEqual([true, true, true])
    expect(everyone((r) => can(r, 'expense.delete', { isOwn: true }))).toEqual([true, true, true])
  })

  it("only lets owners and admins touch other people's expenses", () => {
    expect(everyone((r) => can(r, 'expense.edit', { isOwn: false }))).toEqual([true, true, false])
    expect(everyone((r) => can(r, 'expense.delete', { isOwn: false }))).toEqual([true, true, false])
  })

  it('lets members delete only payments they were part of, like delete_settlement', () => {
    expect(everyone((r) => can(r, 'settlement.delete', { isParty: true }))).toEqual([
      true,
      true,
      true,
    ])
    expect(everyone((r) => can(r, 'settlement.delete', { isParty: false }))).toEqual([
      true,
      true,
      false,
    ])
  })

  it('mirrors update_settlement, restore_settlement and settle_up_v2 for payments', () => {
    for (const action of ['settlement.edit', 'settlement.restore', 'settlement.record'] as const) {
      expect(everyone((r) => can(r, action, { isParty: true }))).toEqual([true, true, true])
      expect(everyone((r) => can(r, action, { isParty: false }))).toEqual([true, true, false])
    }
  })

  it('lets members lock or cancel only events they created', () => {
    for (const action of ['event.lock', 'event.cancel'] as const) {
      expect(everyone((r) => can(r, action, { isCreator: false }))).toEqual([true, true, false])
      expect(everyone((r) => can(r, action, { isCreator: true }))).toEqual([true, true, true])
    }
  })

  it('lets everyone make guest links, like create_guest_link', () => {
    expect(everyone((r) => can(r, 'guestLink.create'))).toEqual([true, true, true])
  })

  it('lets members revoke their own links and remove guests only on plans they organize', () => {
    for (const action of ['guestLink.revoke', 'guest.remove'] as const) {
      expect(everyone((r) => can(r, action, { isCreator: false }))).toEqual([true, true, false])
      expect(everyone((r) => can(r, action, { isCreator: true }))).toEqual([true, true, true])
    }
  })

  it('lets members invite only when the group allows it', () => {
    const invite = (membersCanInvite: boolean) =>
      everyone((r) => can(r, 'invite.create', { membersCanInvite, inviteRole: 'member' }))
    expect(invite(false)).toEqual([true, true, false])
    expect(invite(true)).toEqual([true, true, true])
  })

  it('only lets the owner create invites that grant admin', () => {
    for (const membersCanInvite of [true, false]) {
      expect(
        everyone((r) => can(r, 'invite.create', { membersCanInvite, inviteRole: 'admin' })),
      ).toEqual([true, false, false])
    }
  })

  it('lets owners and admins edit group settings', () => {
    expect(everyone((r) => can(r, 'group.edit'))).toEqual([true, true, false])
  })

  it('lets anyone in the group restore it or edit its notes', () => {
    expect(everyone((r) => can(r, 'group.restore'))).toEqual([true, true, true])
    expect(everyone((r) => can(r, 'group.notes'))).toEqual([true, true, true])
  })

  it('reserves deleting the group and transferring ownership for the owner', () => {
    expect(everyone((r) => can(r, 'group.delete'))).toEqual([true, false, false])
    expect(everyone((r) => can(r, 'group.transferOwnership'))).toEqual([true, false, false])
  })

  describe('removing members', () => {
    const settled = { targetNetCents: 0 }

    it('lets owners remove admins and members, and admins remove members only', () => {
      expect(
        everyone((r) => can(r, 'member.remove', { ...settled, targetRole: 'member' })),
      ).toEqual([true, true, false])
      expect(everyone((r) => can(r, 'member.remove', { ...settled, targetRole: 'admin' }))).toEqual(
        [true, false, false],
      )
      expect(everyone((r) => can(r, 'member.remove', { ...settled, targetRole: 'owner' }))).toEqual(
        [false, false, false],
      )
    })

    it('blocks removing someone with an open balance', () => {
      expect(can('owner', 'member.remove', { targetRole: 'member', targetNetCents: -250 })).toBe(
        false,
      )
    })
  })

  describe('changing roles', () => {
    it('lets the owner move people between admin and member', () => {
      expect(can('owner', 'member.changeRole', { targetRole: 'member', newRole: 'admin' })).toBe(
        true,
      )
      expect(can('owner', 'member.changeRole', { targetRole: 'admin', newRole: 'member' })).toBe(
        true,
      )
    })

    it('lets admins manage members only', () => {
      expect(can('admin', 'member.changeRole', { targetRole: 'member', newRole: 'admin' })).toBe(
        true,
      )
      expect(can('admin', 'member.changeRole', { targetRole: 'admin', newRole: 'member' })).toBe(
        false,
      )
      expect(can('member', 'member.changeRole', { targetRole: 'member', newRole: 'admin' })).toBe(
        false,
      )
    })

    it('never hands out or takes away ownership through a role change', () => {
      expect(can('owner', 'member.changeRole', { targetRole: 'admin', newRole: 'owner' })).toBe(
        false,
      )
      expect(can('owner', 'member.changeRole', { targetRole: 'owner', newRole: 'admin' })).toBe(
        false,
      )
      expect(can('owner', 'member.changeRole', { targetRole: 'member', newRole: 'member' })).toBe(
        false,
      )
    })
  })

  describe('people not on Potluck yet', () => {
    it('lets whoever may invite add them, like add_placeholder_member', () => {
      expect(everyone((r) => can(r, 'placeholder.add', { membersCanInvite: true }))).toEqual([
        true,
        true,
        true,
      ])
      expect(everyone((r) => can(r, 'placeholder.add', { membersCanInvite: false }))).toEqual([
        true,
        true,
        false,
      ])
    })

    it('lets whoever added them rename them even when members cannot invite', () => {
      const locked = { membersCanInvite: false }
      expect(everyone((r) => can(r, 'placeholder.edit', { ...locked, isCreator: true }))).toEqual([
        true,
        true,
        true,
      ])
      expect(everyone((r) => can(r, 'placeholder.edit', { ...locked, isCreator: false }))).toEqual([
        true,
        true,
        false,
      ])
    })

    it('lets admins or whoever added them remove them once settled', () => {
      expect(
        everyone((r) => can(r, 'placeholder.remove', { netCents: 0, isCreator: false })),
      ).toEqual([true, true, false])
      expect(can('member', 'placeholder.remove', { netCents: 0, isCreator: true })).toBe(true)
      expect(can('owner', 'placeholder.remove', { netCents: -700, isCreator: true })).toBe(false)
    })
  })

  describe('leaving', () => {
    it('lets settled admins and members leave', () => {
      expect(everyone((r) => can(r, 'group.leave', { netCents: 0 }))).toEqual([false, true, true])
    })

    it('blocks leaving with an open balance', () => {
      expect(can('member', 'group.leave', { netCents: 100 })).toBe(false)
    })
  })

  it('allows nothing for non-members', () => {
    expect(can(null, 'expense.create')).toBe(false)
    expect(can(undefined, 'group.edit')).toBe(false)
  })
})
