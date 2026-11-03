import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptInvite,
  createGroup,
  createInvite,
  deleteGroup,
  fetchFriends,
  fetchGroup,
  fetchGroupInvites,
  fetchInvitePreview,
  fetchMyGroups,
  friendsQueryOptions,
  getOrCreateDirectGroup,
  groupDetailQueryOptions,
  groupInvitesQueryOptions,
  groupKeys,
  invitePreviewQueryOptions,
  leaveGroup,
  myGroupsQueryOptions,
  removeMember,
  restoreInvite,
  revokeInvite,
  setMemberRole,
  transferOwnership,
  updateGroup,
} from './groups'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_allowed' }

const person = (id: string, name: string, deleted_at: string | null = null) => ({
  id,
  display_name: name,
  avatar_path: null,
  deleted_at,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchMyGroups', () => {
  const flat = {
    id: 'g1',
    name: 'Flat',
    group_members: [
      { role: 'member', joined_at: '2026-01-03', profiles: person('u3', 'Cy') },
      { role: 'member', joined_at: '2026-01-02', profiles: person('u2', 'Bo') },
      { role: 'owner', joined_at: '2026-01-05', profiles: person('u1', 'Ada') },
      { role: 'admin', joined_at: '2026-01-09', profiles: person('u4', 'Di') },
      { role: 'member', joined_at: '2026-01-02', profiles: person('u0', 'Al') },
      { role: 'member', joined_at: '2026-01-01', profiles: null },
    ],
  }
  const trip = {
    id: 'g2',
    name: 'Trip',
    group_members: [{ role: 'owner', joined_at: '2026-01-01', profiles: person('u2', 'Bo') }],
  }

  it('orders members by role, then join date, then id, with balances attached', async () => {
    const fake = fakeSupabase()
      .respond('from:groups', { data: [flat, trip] })
      .respond('from:group_balances', {
        data: [
          { group_id: 'g1', user_id: 'u1', net_cents: 1200 },
          { group_id: 'g1', user_id: 'u2', net_cents: -700 },
          { group_id: 'g1', user_id: 'u3', net_cents: null },
          { group_id: null, user_id: 'u1', net_cents: 5 },
          { group_id: 'g2', user_id: null, net_cents: 5 },
        ],
      })

    const [first, second] = await fetchMyGroups(fake.client, 'u1')

    expect(first!.members.map((m) => [m.id, m.role, m.net_cents])).toEqual([
      ['u1', 'owner', 1200],
      ['u4', 'admin', 0],
      ['u0', 'member', 0],
      ['u2', 'member', -700],
      ['u3', 'member', 0],
    ])
    expect(first).not.toHaveProperty('group_members')
    expect(first!.my_role).toBe('owner')
    expect(first!.my_net_cents).toBe(1200)
    expect(second!.my_role).toBeNull()
    expect(second!.my_net_cents).toBe(0)

    const [groups] = fake.queries('groups')
    expect(argsOf(groups!, 'order')).toEqual([['updated_at', { ascending: false }]])
    const [balances] = fake.queries('group_balances')
    // Balances load in parallel with the groups, so the read is not filtered by group id.
    expect(argsOf(balances!, 'in')).toEqual([])
  })

  it('returns nothing when the viewer has no groups', async () => {
    const fake = fakeSupabase().respond('from:groups', { data: null })
    expect(await fetchMyGroups(fake.client, 'u1')).toEqual([])
  })

  it('treats missing balance data as no balances', async () => {
    const fake = fakeSupabase()
      .respond('from:groups', { data: [trip] })
      .respond('from:group_balances', { data: null })
    const [group] = await fetchMyGroups(fake.client, 'u2')
    expect(group!.my_net_cents).toBe(0)
  })

  it('throws group and balance errors', async () => {
    const failing = fakeSupabase().respond('from:groups', { error: boom })
    await expect(fetchMyGroups(failing.client, 'u1')).rejects.toBe(boom)

    const balances = fakeSupabase()
      .respond('from:groups', { data: [trip] })
      .respond('from:group_balances', { error: boom })
    await expect(fetchMyGroups(balances.client, 'u1')).rejects.toBe(boom)
  })
})

describe('fetchGroup', () => {
  it('assembles one group', async () => {
    const fake = fakeSupabase()
      .respond('from:groups', {
        data: {
          id: 'g1',
          group_members: [{ role: 'owner', joined_at: '2026-01-01', profiles: person('u1', 'A') }],
        },
      })
      .respond('from:group_balances', { data: [{ group_id: 'g1', user_id: 'u1', net_cents: 9 }] })

    const group = await fetchGroup(fake.client, 'g1', 'u1')

    expect(group).toMatchObject({ id: 'g1', my_role: 'owner', my_net_cents: 9 })
    expect(argsOf(fake.queries('groups')[0]!, 'maybeSingle')).toHaveLength(1)
    expect(argsOf(fake.queries('group_balances')[0]!, 'in')).toEqual([['group_id', ['g1']]])
  })

  it('is null when the group is not visible', async () => {
    const fake = fakeSupabase().respond('from:groups', { data: null })
    expect(await fetchGroup(fake.client, 'g1', 'u1')).toBeNull()
  })

  it('throws the read error', async () => {
    const fake = fakeSupabase().respond('from:groups', { error: boom })
    await expect(fetchGroup(fake.client, 'g1', 'u1')).rejects.toBe(boom)
  })
})

describe('group mutations', () => {
  it('creates a group with a trimmed name and only the options given', async () => {
    const fake = fakeSupabase().respond('rpc:create_group', { data: 'g1' })

    expect(await createGroup(fake.client, { name: '  Flat  ', emoji: null })).toBe('g1')
    await createGroup(fake.client, { name: 'Trip', emoji: 'x', color: 'red', currency: 'USD' })

    expect(fake.rpcArgs('create_group')).toEqual([
      { name: 'Flat' },
      { name: 'Trip', emoji: 'x', color: 'red', currency: 'USD' },
    ])
  })

  it('updates settings and returns the row', async () => {
    const fake = fakeSupabase().respond('from:groups', { data: { id: 'g1', name: 'New' } })

    expect(await updateGroup(fake.client, 'g1', { name: 'New' })).toEqual({ id: 'g1', name: 'New' })
    const [query] = fake.queries('groups')
    expect(argsOf(query!, 'update')).toEqual([[{ name: 'New' }]])
    expect(argsOf(query!, 'eq')).toEqual([['id', 'g1']])
  })

  it('deletes a group by id', async () => {
    const fake = fakeSupabase()
    await deleteGroup(fake.client, 'g1')
    const [query] = fake.queries('groups')
    expect(argsOf(query!, 'delete')).toHaveLength(1)
    expect(argsOf(query!, 'eq')).toEqual([['id', 'g1']])
  })

  it('calls the member RPCs with their arguments', async () => {
    const fake = fakeSupabase()

    await setMemberRole(fake.client, 'g1', 'u2', 'admin')
    await removeMember(fake.client, 'g1', 'u3')
    await leaveGroup(fake.client, 'g1')
    await transferOwnership(fake.client, 'g1', 'u2')

    expect(fake.calls.map((c) => (c.kind === 'rpc' ? [c.name, c.args] : null))).toEqual([
      ['set_member_role', { group_id: 'g1', user_id: 'u2', role: 'admin' }],
      ['remove_member', { group_id: 'g1', user_id: 'u3' }],
      ['leave_group', { group_id: 'g1' }],
      ['transfer_ownership', { group_id: 'g1', user_id: 'u2' }],
    ])
  })

  it('rethrows every mutation error', async () => {
    const fake = fakeSupabase()
      .respond('rpc:create_group', { error: boom })
      .respond('from:groups', { error: boom })
      .respond('rpc:set_member_role', { error: boom })
      .respond('rpc:remove_member', { error: boom })
      .respond('rpc:leave_group', { error: boom })
      .respond('rpc:transfer_ownership', { error: boom })
    const { client } = fake

    await expect(createGroup(client, { name: 'x' })).rejects.toBe(boom)
    await expect(updateGroup(client, 'g1', {})).rejects.toBe(boom)
    await expect(deleteGroup(client, 'g1')).rejects.toBe(boom)
    await expect(setMemberRole(client, 'g1', 'u2', 'member')).rejects.toBe(boom)
    await expect(removeMember(client, 'g1', 'u2')).rejects.toBe(boom)
    await expect(leaveGroup(client, 'g1')).rejects.toBe(boom)
    await expect(transferOwnership(client, 'g1', 'u2')).rejects.toBe(boom)
  })
})

describe('invites', () => {
  it('keeps only invites that have not expired or been used up', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') })
    const fake = fakeSupabase().respond('from:group_invites', {
      data: [
        { id: 'open', expires_at: null, max_uses: null, uses: 3 },
        { id: 'future', expires_at: '2026-07-01T00:00:00Z', max_uses: 5, uses: 4 },
        { id: 'expired', expires_at: '2026-05-01T00:00:00Z', max_uses: null, uses: 0 },
        { id: 'used', expires_at: null, max_uses: 2, uses: 2 },
      ],
    })

    const invites = await fetchGroupInvites(fake.client, 'g1')

    expect(invites.map((i) => i.id)).toEqual(['open', 'future'])
    const [query] = fake.queries('group_invites')
    expect(argsOf(query!, 'eq')).toEqual([['group_id', 'g1']])
    expect(argsOf(query!, 'is')).toEqual([['revoked_at', null]])
  })

  it('handles an empty or failed invite read', async () => {
    const empty = fakeSupabase().respond('from:group_invites', { data: null })
    expect(await fetchGroupInvites(empty.client, 'g1')).toEqual([])

    const failing = fakeSupabase().respond('from:group_invites', { error: boom })
    await expect(fetchGroupInvites(failing.client, 'g1')).rejects.toBe(boom)
  })

  it('creates member invites by default and passes optional limits', async () => {
    const fake = fakeSupabase().respond('rpc:create_invite', { data: { code: 'abc' } })

    expect(await createInvite(fake.client, { groupId: 'g1', maxUses: 0 })).toEqual({ code: 'abc' })
    await createInvite(fake.client, {
      groupId: 'g1',
      role: 'admin',
      maxUses: 3,
      expiresAt: '2026-07-01',
      email: 'a@b.c',
    })

    expect(fake.rpcArgs('create_invite')).toEqual([
      { group_id: 'g1', role: 'member' },
      { group_id: 'g1', role: 'admin', max_uses: 3, expires_at: '2026-07-01', email: 'a@b.c' },
    ])
  })

  it('revokes and restores an invite', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-01T00:00:00Z') })
    const fake = fakeSupabase()

    await revokeInvite(fake.client, 'i1')
    await restoreInvite(fake.client, 'i1')

    const [revoke, restore] = fake.queries('group_invites')
    expect(argsOf(revoke!, 'update')).toEqual([[{ revoked_at: '2026-06-01T00:00:00.000Z' }]])
    expect(argsOf(revoke!, 'eq')).toEqual([['id', 'i1']])
    expect(argsOf(restore!, 'update')).toEqual([[{ revoked_at: null }]])
  })

  it('rethrows invite write errors', async () => {
    const fake = fakeSupabase()
      .respond('rpc:create_invite', { error: boom })
      .respond('from:group_invites', { error: boom })
      .respond('rpc:accept_invite', { error: boom })
    await expect(createInvite(fake.client, { groupId: 'g1' })).rejects.toBe(boom)
    await expect(revokeInvite(fake.client, 'i1')).rejects.toBe(boom)
    await expect(restoreInvite(fake.client, 'i1')).rejects.toBe(boom)
    await expect(acceptInvite(fake.client, 'abc')).rejects.toBe(boom)
  })

  it('previews an invite with first names defaulted', async () => {
    const fake = fakeSupabase().respond('rpc:invite_preview', {
      data: [{ group_id: 'g1', name: 'Flat', status: 'valid', first_names: null }],
    })

    expect(await fetchInvitePreview(fake.client, 'abc')).toEqual({
      group_id: 'g1',
      name: 'Flat',
      status: 'valid',
      first_names: [],
    })
    expect(fake.rpcArgs('invite_preview')).toEqual([{ code: 'abc' }])
  })

  it('throws invite_not_found for an unknown code, and RPC errors as is', async () => {
    const fake = fakeSupabase().respond('rpc:invite_preview', { data: [] })
    await expect(fetchInvitePreview(fake.client, 'nope')).rejects.toMatchObject({
      message: 'invite_not_found',
      code: 'PT404',
    })

    const failing = fakeSupabase().respond('rpc:invite_preview', { error: boom })
    await expect(fetchInvitePreview(failing.client, 'abc')).rejects.toBe(boom)
  })

  it('accepts an invite and returns the group id', async () => {
    const fake = fakeSupabase().respond('rpc:accept_invite', { data: 'g1' })
    expect(await acceptInvite(fake.client, 'abc')).toBe('g1')
    expect(fake.rpcArgs('accept_invite')).toEqual([{ code: 'abc' }])
  })
})

describe('fetchFriends', () => {
  it('pairs friends with their 1:1 group and mirrors the balance', async () => {
    const fake = fakeSupabase()
      .respond('from:friendships', {
        data: [
          { friend: person('u3', 'Zed') },
          { friend: person('u2', 'Bo') },
          { friend: person('u4', 'Gone', '2026-01-01') },
          { friend: null },
          { friend: person('u5', 'Cat') },
        ],
      })
      .respond('from:groups', {
        data: [
          { id: 'd2', currency: 'EUR', group_members: [{ user_id: 'u1' }, { user_id: 'u2' }] },
          { id: 'd3', currency: 'USD', group_members: [{ user_id: 'u3' }, { user_id: 'u1' }] },
          { id: 'solo', currency: 'EUR', group_members: [{ user_id: 'u1' }] },
        ],
      })
      .respond('from:group_balances', {
        data: [
          { group_id: 'd2', user_id: 'u2', net_cents: -400 },
          { group_id: 'd2', user_id: 'u1', net_cents: 400 },
        ],
      })

    const friends = await fetchFriends(fake.client, 'u1')

    expect(friends.map((f) => [f.id, f.direct_group_id, f.net_cents, f.currency])).toEqual([
      ['u2', 'd2', 400, 'EUR'],
      ['u5', null, 0, null],
      ['u3', 'd3', 0, 'USD'],
    ])
    expect(argsOf(fake.queries('friendships')[0]!, 'eq')).toEqual([['user_id', 'u1']])
    expect(argsOf(fake.queries('groups')[0]!, 'eq')).toEqual([['is_direct', true]])
    expect(argsOf(fake.queries('group_balances')[0]!, 'in')).toEqual([['group_id', ['d2', 'd3']]])
  })

  it('returns nobody when there are no friendships or direct groups', async () => {
    const fake = fakeSupabase()
      .respond('from:friendships', { data: null })
      .respond('from:groups', { data: null })
    expect(await fetchFriends(fake.client, 'u1')).toEqual([])
    expect(fake.queries('group_balances')).toHaveLength(0)
  })

  it('throws either read error', async () => {
    const friendships = fakeSupabase()
      .respond('from:friendships', { error: boom })
      .respond('from:groups', { data: [] })
    await expect(fetchFriends(friendships.client, 'u1')).rejects.toBe(boom)

    const direct = fakeSupabase()
      .respond('from:friendships', { data: [] })
      .respond('from:groups', { error: boom })
    await expect(fetchFriends(direct.client, 'u1')).rejects.toBe(boom)
  })

  it('gets or creates the direct group', async () => {
    const fake = fakeSupabase().respond('rpc:get_or_create_direct_group', { data: 'd2' })
    expect(await getOrCreateDirectGroup(fake.client, 'u2')).toBe('d2')
    expect(fake.rpcArgs('get_or_create_direct_group')).toEqual([{ friend_id: 'u2' }])

    const failing = fakeSupabase().respond('rpc:get_or_create_direct_group', { error: boom })
    await expect(getOrCreateDirectGroup(failing.client, 'u2')).rejects.toBe(boom)
  })
})

describe('query options', () => {
  it('uses the group keys and runs the fetchers', async () => {
    const fake = fakeSupabase()
      .respond('from:groups', { data: [] }, { data: null }, { data: [] })
      .respond('from:group_invites', { data: [] })
      .respond('rpc:invite_preview', { data: [{ status: 'valid', first_names: ['A'] }] })
      .respond('from:friendships', { data: [] })
    const { client } = fake
    const run = (o: { queryFn?: unknown }) => (o.queryFn as () => Promise<unknown>)()

    const list = myGroupsQueryOptions(client, 'u1')
    const detail = groupDetailQueryOptions(client, 'g1', 'u1')
    const invites = groupInvitesQueryOptions(client, 'g1')
    const preview = invitePreviewQueryOptions(client, 'abc')
    const friends = friendsQueryOptions(client, 'u1')

    expect(list.queryKey).toEqual(groupKeys.list('u1'))
    expect(detail.queryKey).toEqual(['potluck', 'groups', 'detail', 'g1'])
    expect(invites.queryKey).toEqual(groupKeys.invites('g1'))
    expect(preview.queryKey).toEqual(['potluck', 'groups', 'invite-preview', 'abc'])
    expect(preview.retry).toBe(false)
    expect(friends.queryKey).toEqual(groupKeys.friends('u1'))

    expect(await run(list)).toEqual([])
    expect(await run(detail)).toBeNull()
    expect(await run(invites)).toEqual([])
    expect(await run(preview)).toMatchObject({ status: 'valid', first_names: ['A'] })
    expect(await run(friends)).toEqual([])
  })
})
