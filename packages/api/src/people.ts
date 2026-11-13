/**
 * people queries and mutations: someone not on Potluck yet (placeholders, ADR 19), friend links,
 * removing, blocking and reporting people. Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { PotluckClient } from './index'

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export const peopleKeys = {
  all: ['potluck', 'people'] as const,
  placeholders: (groupId: string) => ['potluck', 'people', 'placeholders', groupId] as const,
  friendLink: (userId: string) => ['potluck', 'people', 'friend-link', userId] as const,
  friendInvite: (code: string) => ['potluck', 'people', 'friend-invite', code] as const,
  blocks: (userId: string) => ['potluck', 'people', 'blocks', userId] as const,
}

// Placeholders -------------------------------------------------------------------------------

/** What group mates may know about a placeholder; `claim_code` only for admins and its adder. */
export interface Placeholder {
  profile_id: string
  email_hint: string | null
  created_by: string | null
  invited_at: string | null
  reminded_at: string | null
  claim_code: string | null
}

/** Placeholders of a group (current and removed ones the history still names), by profile id. */
export async function fetchGroupPlaceholders(
  client: PotluckClient,
  groupId: string,
): Promise<Map<string, Placeholder>> {
  const [rows, links] = await Promise.all([
    client
      .from('placeholders')
      .select('profile_id, email_hint, created_by, invited_at, reminded_at')
      .eq('group_id', groupId),
    client
      .from('group_invites')
      .select('code, placeholder_id, created_at')
      .eq('group_id', groupId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ])
  const codes = new Map<string, string>()
  for (const link of unwrap(links) ?? []) {
    if (link.placeholder_id && !codes.has(link.placeholder_id)) {
      codes.set(link.placeholder_id, link.code)
    }
  }
  const out = new Map<string, Placeholder>()
  for (const row of unwrap(rows) ?? []) {
    out.set(row.profile_id, { ...row, claim_code: codes.get(row.profile_id) ?? null })
  }
  return out
}

export const groupPlaceholdersQueryOptions = (client: PotluckClient, groupId: string) =>
  queryOptions({
    queryKey: peopleKeys.placeholders(groupId),
    queryFn: () => fetchGroupPlaceholders(client, groupId),
  })

export interface PlaceholderInput {
  groupId: string
  displayName: string
  email?: string | null
}

/** Adds someone by name (and maybe email) and returns their placeholder id. */
export async function addPlaceholderMember(
  client: PotluckClient,
  input: PlaceholderInput,
): Promise<string> {
  return unwrap(
    await client.rpc('add_placeholder_member', {
      group_id: input.groupId,
      display_name: input.displayName,
      ...(input.email ? { email: input.email } : {}),
    }),
  )
}

/**
 * Renames a placeholder or changes where its invite goes. Leave a field out to keep it; an
 * empty email removes the address.
 */
export async function updatePlaceholder(
  client: PotluckClient,
  userId: string,
  patch: { displayName?: string; email?: string },
) {
  unwrap(
    await client.rpc('update_placeholder', {
      user_id: userId,
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
    }),
  )
}

/** Sends the one reminder email a placeholder's invite gets. */
export async function remindPlaceholder(client: PotluckClient, userId: string) {
  unwrap(await client.rpc('remind_placeholder', { user_id: userId }))
}

/** Removes a settled placeholder (admins, or whoever added them). */
export async function removePlaceholder(client: PotluckClient, userId: string) {
  unwrap(await client.rpc('remove_placeholder', { user_id: userId }))
}

// Friend links -------------------------------------------------------------------------------

/** The viewer's personal friend link code; `rotate` retires the old link. */
export async function fetchMyFriendLink(client: PotluckClient, rotate = false): Promise<string> {
  return unwrap(await client.rpc('my_friend_link', { rotate }))
}

export const myFriendLinkQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: peopleKeys.friendLink(userId),
    queryFn: () => fetchMyFriendLink(client),
    staleTime: Infinity,
  })

/** A single-use friend link only `email` can accept. Returns its code. */
export async function createFriendInvite(client: PotluckClient, email: string): Promise<string> {
  return unwrap(await client.rpc('create_friend_invite', { email })).code
}

export interface FriendInvitePreview {
  name: string
  avatar_path: string | null
  status: 'valid' | 'expired' | 'revoked' | 'used_up' | 'blocked'
  is_friend: boolean
  is_self: boolean
}

/** Who a friend link is from. Works signed out; throws `invite_not_found` for unknown codes. */
export async function fetchFriendInvitePreview(
  client: PotluckClient,
  code: string,
): Promise<FriendInvitePreview> {
  const row = unwrap(await client.rpc('friend_invite_preview', { code }))?.[0]
  if (!row) throw Object.assign(new Error('invite_not_found'), { code: 'PT404' })
  return { ...row, status: row.status as FriendInvitePreview['status'] }
}

export const friendInvitePreviewQueryOptions = (client: PotluckClient, code: string) =>
  queryOptions({
    queryKey: peopleKeys.friendInvite(code),
    queryFn: () => fetchFriendInvitePreview(client, code),
    retry: false,
  })

/** Accepts a friend link and returns the new friend's id. */
export async function acceptFriendInvite(client: PotluckClient, code: string): Promise<string> {
  return unwrap(await client.rpc('accept_friend_invite', { code }))
}

/** Adds someone the viewer shares a group with. */
export async function addFriend(client: PotluckClient, userId: string) {
  unwrap(await client.rpc('add_friend', { user_id: userId }))
}

/** Removes a friend both ways; refused while the 1:1 balance is open (`friend_has_balance`). */
export async function removeFriend(client: PotluckClient, friendId: string) {
  unwrap(await client.rpc('remove_friend', { friend_id: friendId }))
}

// Blocks and reports -------------------------------------------------------------------------

export interface BlockedPerson {
  user_id: string
  display_name: string
  avatar_path: string | null
  blocked_at: string
}

/** Blocks someone (they are not told) and ends the friendship both ways. */
export async function blockUser(client: PotluckClient, userId: string) {
  unwrap(await client.rpc('block_user', { user_id: userId }))
}

export async function unblockUser(client: PotluckClient, viewerId: string, userId: string) {
  unwrap(await client.from('blocks').delete().eq('blocker_id', viewerId).eq('blocked_id', userId))
}

export async function fetchMyBlocks(client: PotluckClient): Promise<BlockedPerson[]> {
  return unwrap(await client.rpc('my_blocks')) ?? []
}

export const myBlocksQueryOptions = (client: PotluckClient, userId: string) =>
  queryOptions({
    queryKey: peopleKeys.blocks(userId),
    queryFn: () => fetchMyBlocks(client),
  })

/** Tells the Potluck team about a person (or a group). */
export async function reportPerson(
  client: PotluckClient,
  input: { userId?: string | null; groupId?: string | null; reason: string },
) {
  unwrap(
    await client.from('reports').insert({
      subject_user_id: input.userId ?? null,
      group_id: input.groupId ?? null,
      reason: input.reason.trim(),
    }),
  )
}
