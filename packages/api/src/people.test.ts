import { describe, expect, it } from 'vitest'
import {
  acceptFriendInvite,
  addFriend,
  addPlaceholderMember,
  blockUser,
  createFriendInvite,
  fetchFriendInvitePreview,
  fetchGroupPlaceholders,
  fetchMyBlocks,
  fetchMyFriendLink,
  friendInvitePreviewQueryOptions,
  groupPlaceholdersQueryOptions,
  myBlocksQueryOptions,
  myFriendLinkQueryOptions,
  peopleKeys,
  remindPlaceholder,
  removeFriend,
  removePlaceholder,
  reportPerson,
  unblockUser,
  updatePlaceholder,
} from './people'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_allowed' }

describe('placeholders', () => {
  it('reads a group placeholders with the newest open claim link each', async () => {
    const fake = fakeSupabase({
      tables: {
        placeholders: [
          {
            profile_id: 'p1',
            group_id: 'g1',
            email_hint: 's***@x.io',
            created_by: 'u1',
            invited_at: 't',
            reminded_at: null,
          },
          {
            profile_id: 'p2',
            group_id: 'g1',
            email_hint: null,
            created_by: 'u2',
            invited_at: null,
            reminded_at: null,
          },
          {
            profile_id: 'p3',
            group_id: 'g2',
            email_hint: null,
            created_by: 'u2',
            invited_at: null,
            reminded_at: null,
          },
        ],
        group_invites: [
          {
            code: 'old',
            placeholder_id: 'p1',
            group_id: 'g1',
            revoked_at: null,
            created_at: '2026-01-01',
          },
          {
            code: 'new',
            placeholder_id: 'p1',
            group_id: 'g1',
            revoked_at: null,
            created_at: '2026-02-01',
          },
          {
            code: 'gone',
            placeholder_id: 'p2',
            group_id: 'g1',
            revoked_at: '2026-02-02',
            created_at: '2026-02-01',
          },
          {
            code: 'plain',
            placeholder_id: null,
            group_id: 'g1',
            revoked_at: null,
            created_at: '2026-03-01',
          },
        ],
      },
    })
    const result = await fetchGroupPlaceholders(fake.client, 'g1')
    expect([...result.keys()]).toEqual(['p1', 'p2'])
    expect(result.get('p1')).toMatchObject({ email_hint: 's***@x.io', claim_code: 'new' })
    expect(result.get('p2')?.claim_code).toBeNull()
    expect(groupPlaceholdersQueryOptions(fake.client, 'g1').queryKey).toEqual(
      peopleKeys.placeholders('g1'),
    )
  })

  it('throws read errors as they are', async () => {
    const fake = fakeSupabase().respond('from:placeholders', { error: boom })
    await expect(fetchGroupPlaceholders(fake.client, 'g1')).rejects.toBe(boom)
  })

  it('adds, edits, reminds and removes through the RPCs', async () => {
    const fake = fakeSupabase().respond('rpc:add_placeholder_member', { data: 'p1' })
    expect(
      await addPlaceholderMember(fake.client, {
        groupId: 'g1',
        displayName: 'Sam',
        email: 'sam@x.io',
      }),
    ).toBe('p1')
    await addPlaceholderMember(fake.client, { groupId: 'g1', displayName: 'Pat', email: '' })
    expect(fake.rpcArgs('add_placeholder_member')).toEqual([
      { group_id: 'g1', display_name: 'Sam', email: 'sam@x.io' },
      { group_id: 'g1', display_name: 'Pat' },
    ])

    await updatePlaceholder(fake.client, 'p1', { displayName: 'Sam Lee' })
    await updatePlaceholder(fake.client, 'p1', { email: '' })
    expect(fake.rpcArgs('update_placeholder')).toEqual([
      { user_id: 'p1', display_name: 'Sam Lee' },
      { user_id: 'p1', email: '' },
    ])

    await remindPlaceholder(fake.client, 'p1')
    await removePlaceholder(fake.client, 'p1')
    expect(fake.rpcArgs('remind_placeholder')).toEqual([{ user_id: 'p1' }])
    expect(fake.rpcArgs('remove_placeholder')).toEqual([{ user_id: 'p1' }])
  })

  it('throws the server code', async () => {
    const fake = fakeSupabase()
      .respond('rpc:add_placeholder_member', { error: boom })
      .respond('rpc:remind_placeholder', { error: boom })
    await expect(
      addPlaceholderMember(fake.client, { groupId: 'g1', displayName: 'Sam' }),
    ).rejects.toBe(boom)
    await expect(remindPlaceholder(fake.client, 'p1')).rejects.toBe(boom)
  })
})

describe('friend links', () => {
  it('reads and rotates the personal link', async () => {
    const fake = fakeSupabase().respond('rpc:my_friend_link', { data: 'code1' }, { data: 'code2' })
    expect(await fetchMyFriendLink(fake.client)).toBe('code1')
    expect(await fetchMyFriendLink(fake.client, true)).toBe('code2')
    expect(fake.rpcArgs('my_friend_link')).toEqual([{ rotate: false }, { rotate: true }])
    expect(myFriendLinkQueryOptions(fake.client, 'u1').queryKey).toEqual(
      peopleKeys.friendLink('u1'),
    )
  })

  it('makes an email invite and returns its code', async () => {
    const fake = fakeSupabase().respond('rpc:create_friend_invite', { data: { code: 'mail1' } })
    expect(await createFriendInvite(fake.client, 'cleo@x.io')).toBe('mail1')
    expect(fake.rpcArgs('create_friend_invite')).toEqual([{ email: 'cleo@x.io' }])
  })

  it('previews a link, or says it is not found', async () => {
    const fake = fakeSupabase().respond(
      'rpc:friend_invite_preview',
      {
        data: [
          { name: 'Ava', avatar_path: null, status: 'valid', is_friend: false, is_self: false },
        ],
      },
      { data: [] },
    )
    expect(await fetchFriendInvitePreview(fake.client, 'c')).toMatchObject({
      name: 'Ava',
      status: 'valid',
    })
    await expect(fetchFriendInvitePreview(fake.client, 'c')).rejects.toMatchObject({
      message: 'invite_not_found',
      code: 'PT404',
    })
    const options = friendInvitePreviewQueryOptions(fake.client, 'c')
    expect(options.queryKey).toEqual(peopleKeys.friendInvite('c'))
    expect(options.retry).toBe(false)
  })

  it('accepts, adds and removes friends', async () => {
    const fake = fakeSupabase().respond('rpc:accept_friend_invite', { data: 'u1' })
    expect(await acceptFriendInvite(fake.client, 'c')).toBe('u1')
    await addFriend(fake.client, 'u2')
    await removeFriend(fake.client, 'u3')
    expect(fake.rpcArgs('add_friend')).toEqual([{ user_id: 'u2' }])
    expect(fake.rpcArgs('remove_friend')).toEqual([{ friend_id: 'u3' }])
  })
})

describe('blocks and reports', () => {
  it('blocks through the RPC and unblocks with a direct delete', async () => {
    const fake = fakeSupabase()
    await blockUser(fake.client, 'u2')
    await unblockUser(fake.client, 'me', 'u2')
    expect(fake.rpcArgs('block_user')).toEqual([{ user_id: 'u2' }])
    const [del] = fake.queries('blocks')
    expect(argsOf(del!, 'eq')).toEqual([
      ['blocker_id', 'me'],
      ['blocked_id', 'u2'],
    ])
  })

  it('lists the blocked people, empty when there are none', async () => {
    const fake = fakeSupabase().respond(
      'rpc:my_blocks',
      { data: [{ user_id: 'u2', display_name: 'Dan', avatar_path: null, blocked_at: 't' }] },
      { data: null },
    )
    expect(await fetchMyBlocks(fake.client)).toHaveLength(1)
    expect(await fetchMyBlocks(fake.client)).toEqual([])
    expect(myBlocksQueryOptions(fake.client, 'me').queryKey).toEqual(peopleKeys.blocks('me'))
  })

  it('files a report with a trimmed reason', async () => {
    const fake = fakeSupabase()
    await reportPerson(fake.client, { userId: 'u2', reason: '  spam  ' })
    await reportPerson(fake.client, { groupId: 'g1', reason: 'scam' })
    const [first, second] = fake.queries('reports')
    expect(argsOf(first!, 'insert')).toEqual([
      [{ subject_user_id: 'u2', group_id: null, reason: 'spam' }],
    ])
    expect(argsOf(second!, 'insert')[0]).toEqual([
      { subject_user_id: null, group_id: 'g1', reason: 'scam' },
    ])
  })

  it('throws write errors as they are', async () => {
    const fake = fakeSupabase().respond('from:reports', { error: boom })
    await expect(reportPerson(fake.client, { userId: 'u2', reason: 'x' })).rejects.toBe(boom)
  })
})
