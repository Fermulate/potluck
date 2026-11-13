/**
 * groups queries and mutations. Platform-neutral: no DOM imports.
 *
 * Every function takes the client as its first argument so web and native can share them.
 * Errors are rethrown as-is: RPC errors carry a stable snake_case code in `message`.
 */
import { queryOptions } from '@tanstack/react-query'
import type { Database } from './database.types'
import type { PotluckClient } from './index'

type Tables = Database['public']['Tables']
export type GroupRole = Database['public']['Enums']['group_role']
export type GroupRow = Tables['groups']['Row']
export type GroupInviteRow = Tables['group_invites']['Row']

/** The slice of a profile the app shows next to people. */
export interface PersonSummary {
  id: string
  display_name: string
  avatar_path: string | null
  deleted_at: string | null
  /** Added by name, not on Potluck yet (ADR 19): no account, no notifications. */
  is_placeholder?: boolean
}

export interface GroupMember extends PersonSummary {
  role: GroupRole
  joined_at: string
  /** Net balance in the group currency. Positive means they are owed. */
  net_cents: number
}

export interface GroupDetail extends GroupRow {
  members: GroupMember[]
  /** The viewer's role, or null if they are not a member (should not happen under RLS). */
  my_role: GroupRole | null
  /** The viewer's net balance in this group, in the group currency. */
  my_net_cents: number
}

export interface InvitePreview {
  group_id: string
  name: string
  emoji: string | null
  color: string | null
  cover_path: string | null
  member_count: number
  first_names: string[]
  status: 'valid' | 'expired' | 'revoked' | 'used_up' | 'archived' | 'blocked'
  is_member: boolean
  /** First name of the seat a claim link hands over, if it is one. */
  placeholder_name?: string | null
  /** The email a claim link is bound to, masked (`s***@example.com`). */
  email_hint?: string | null
}

export interface Friend extends PersonSummary {
  /** The 1:1 group with this friend, if one exists yet. */
  direct_group_id: string | null
  /** The viewer's net in the 1:1 group (positive: the friend owes the viewer). */
  net_cents: number
  currency: string | null
}

export const groupKeys = {
  all: ['potluck', 'groups'] as const,
  list: (userId: string) => ['potluck', 'groups', 'list', userId] as const,
  detail: (groupId: string) => ['potluck', 'groups', 'detail', groupId] as const,
  invites: (groupId: string) => ['potluck', 'groups', 'invites', groupId] as const,
  invitePreview: (code: string) => ['potluck', 'groups', 'invite-preview', code] as const,
  friends: (userId: string) => ['potluck', 'groups', 'friends', userId] as const,
}

const GROUP_SELECT =
  '*, group_members(role, joined_at, profiles(id, display_name, avatar_path, deleted_at, is_placeholder))' as const

type GroupWithMembers = GroupRow & {
  group_members: {
    role: GroupRole
    joined_at: string
    profiles: PersonSummary | null
  }[]
}

function assemble(
  group: GroupWithMembers,
  balances: Map<string, number>,
  viewerId: string,
): GroupDetail {
  const { group_members, ...row } = group
  const roleOrder: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 }
  const members: GroupMember[] = group_members
    .filter((m) => m.profiles)
    .map((m) => ({
      ...(m.profiles as PersonSummary),
      role: m.role,
      joined_at: m.joined_at,
      net_cents: balances.get(`${group.id}:${m.profiles!.id}`) ?? 0,
    }))
    .sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        a.joined_at.localeCompare(b.joined_at) ||
        a.id.localeCompare(b.id),
    )
  const me = members.find((m) => m.id === viewerId)
  return {
    ...row,
    members,
    my_role: me?.role ?? null,
    my_net_cents: me?.net_cents ?? 0,
  }
}

/**
 * Balances keyed `group:user`. `groupIds` null means every group the viewer is in: RLS already
 * limits the view to those, so the request does not have to wait for the group list.
 */
async function balancesFor(client: PotluckClient, groupIds: string[] | null) {
  const map = new Map<string, number>()
  if (groupIds && groupIds.length === 0) return map
  const query = client.from('group_balances').select('group_id, user_id, net_cents')
  const { data, error } = await (groupIds ? query.in('group_id', groupIds) : query)
  if (error) throw error
  for (const row of data ?? []) {
    if (row.group_id && row.user_id) map.set(`${row.group_id}:${row.user_id}`, row.net_cents ?? 0)
  }
  return map
}

/** Every group the viewer belongs to (direct groups included), newest activity first. */
export async function fetchMyGroups(client: PotluckClient, viewerId: string) {
  // Both requests go out together instead of one after the other.
  const [{ data, error }, balances] = await Promise.all([
    client.from('groups').select(GROUP_SELECT).order('updated_at', { ascending: false }),
    balancesFor(client, null),
  ])
  if (error) throw error
  const groups = (data ?? []) as unknown as GroupWithMembers[]
  return groups.map((g) => assemble(g, balances, viewerId))
}

export async function fetchGroup(client: PotluckClient, groupId: string, viewerId: string) {
  const [{ data, error }, balances] = await Promise.all([
    client.from('groups').select(GROUP_SELECT).eq('id', groupId).maybeSingle(),
    balancesFor(client, [groupId]),
  ])
  if (error) throw error
  if (!data) return null
  return assemble(data as unknown as GroupWithMembers, balances, viewerId)
}

export const myGroupsQueryOptions = (client: PotluckClient, viewerId: string) =>
  queryOptions({
    queryKey: groupKeys.list(viewerId),
    queryFn: () => fetchMyGroups(client, viewerId),
  })

export const groupDetailQueryOptions = (client: PotluckClient, groupId: string, viewerId: string) =>
  queryOptions({
    queryKey: groupKeys.detail(groupId),
    queryFn: () => fetchGroup(client, groupId, viewerId),
  })

export interface CreateGroupInput {
  name: string
  emoji?: string | null
  color?: string | null
  currency?: string | null
}

export async function createGroup(client: PotluckClient, input: CreateGroupInput) {
  const { data, error } = await client.rpc('create_group', {
    name: input.name.trim(),
    ...(input.emoji ? { emoji: input.emoji } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
  })
  if (error) throw error
  return data
}

export type GroupSettingsPatch = Partial<
  Pick<
    GroupRow,
    | 'name'
    | 'emoji'
    | 'color'
    | 'cover_path'
    | 'currency'
    | 'simplify_debts'
    | 'members_can_invite'
    | 'archived_at'
  >
>

export async function updateGroup(
  client: PotluckClient,
  groupId: string,
  patch: GroupSettingsPatch,
) {
  const { data, error } = await client
    .from('groups')
    .update(patch)
    .eq('id', groupId)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Owner only; the server refuses while anyone still has an open balance (group_has_balances). */
export async function deleteGroup(client: PotluckClient, groupId: string) {
  const { error } = await client.rpc('delete_group', { group_id: groupId })
  if (error) throw error
}

export async function setMemberRole(
  client: PotluckClient,
  groupId: string,
  userId: string,
  role: GroupRole,
) {
  const { error } = await client.rpc('set_member_role', {
    group_id: groupId,
    user_id: userId,
    role,
  })
  if (error) throw error
}

export async function removeMember(client: PotluckClient, groupId: string, userId: string) {
  const { error } = await client.rpc('remove_member', { group_id: groupId, user_id: userId })
  if (error) throw error
}

export async function leaveGroup(client: PotluckClient, groupId: string) {
  const { error } = await client.rpc('leave_group', { group_id: groupId })
  if (error) throw error
}

export async function transferOwnership(client: PotluckClient, groupId: string, userId: string) {
  const { error } = await client.rpc('transfer_ownership', { group_id: groupId, user_id: userId })
  if (error) throw error
}

// Invites ----------------------------------------------------------------------

/** Invites the viewer can see for a group (admins: all, members: their own), open ones first. */
export async function fetchGroupInvites(client: PotluckClient, groupId: string) {
  const { data, error } = await client
    .from('group_invites')
    .select('*')
    .eq('group_id', groupId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  const now = Date.now()
  return (data ?? []).filter(
    (invite) =>
      (!invite.expires_at || Date.parse(invite.expires_at) > now) &&
      (invite.max_uses == null || invite.uses < invite.max_uses),
  )
}

export const groupInvitesQueryOptions = (client: PotluckClient, groupId: string) =>
  queryOptions({
    queryKey: groupKeys.invites(groupId),
    queryFn: () => fetchGroupInvites(client, groupId),
  })

export interface CreateInviteInput {
  groupId: string
  role?: 'admin' | 'member'
  maxUses?: number | null
  expiresAt?: string | null
  email?: string | null
}

export async function createInvite(client: PotluckClient, input: CreateInviteInput) {
  const { data, error } = await client.rpc('create_invite', {
    group_id: input.groupId,
    role: input.role ?? 'member',
    ...(input.maxUses ? { max_uses: input.maxUses } : {}),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    ...(input.email ? { email: input.email } : {}),
  })
  if (error) throw error
  return data
}

export async function revokeInvite(client: PotluckClient, inviteId: string) {
  const { error } = await client
    .from('group_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

/** Undoes `revokeInvite`. */
export async function restoreInvite(client: PotluckClient, inviteId: string) {
  const { error } = await client
    .from('group_invites')
    .update({ revoked_at: null })
    .eq('id', inviteId)
  if (error) throw error
}

/**
 * Public preview of an invite, including the seat a claim link hands over (`invite_preview_v2`).
 * Works signed out. Throws `invite_not_found` for unknown codes.
 */
export async function fetchInvitePreview(
  client: PotluckClient,
  code: string,
): Promise<InvitePreview> {
  const { data, error } = await client.rpc('invite_preview_v2', { code })
  if (error) throw error
  const row = data?.[0]
  if (!row) throw Object.assign(new Error('invite_not_found'), { code: 'PT404' })
  return {
    ...row,
    status: row.status as InvitePreview['status'],
    first_names: row.first_names ?? [],
  }
}

export const invitePreviewQueryOptions = (client: PotluckClient, code: string) =>
  queryOptions({
    queryKey: groupKeys.invitePreview(code),
    queryFn: () => fetchInvitePreview(client, code),
    retry: false,
  })

/** Joins the group behind `code` and returns its id. */
export async function acceptInvite(client: PotluckClient, code: string): Promise<string> {
  const { data, error } = await client.rpc('accept_invite', { code })
  if (error) throw error
  return data
}

// Friends ----------------------------------------------------------------------

/**
 * People the viewer is friends with, with the balance in each 1:1 group. Friends who closed
 * their account drop off.
 */
export async function fetchFriends(client: PotluckClient, viewerId: string): Promise<Friend[]> {
  const [friendships, direct] = await Promise.all([
    client
      .from('friendships')
      .select(
        'friend:profiles!friendships_friend_id_fkey(id, display_name, avatar_path, deleted_at)',
      )
      .eq('user_id', viewerId),
    client.from('groups').select('id, currency, group_members(user_id)').eq('is_direct', true),
  ])
  if (friendships.error) throw friendships.error
  if (direct.error) throw direct.error

  const directByFriend = new Map<string, { id: string; currency: string }>()
  for (const g of direct.data ?? []) {
    const other = g.group_members.find((m) => m.user_id !== viewerId)
    if (other) directByFriend.set(other.user_id, { id: g.id, currency: g.currency })
  }
  const balances = await balancesFor(
    client,
    [...directByFriend.values()].map((g) => g.id),
  )

  const friends: Friend[] = []
  for (const row of friendships.data ?? []) {
    const person = row.friend as PersonSummary | null
    if (!person || person.deleted_at) continue
    const group = directByFriend.get(person.id)
    // The friend's own net is the mirror of the viewer's in a two-person group.
    const theirNet = group ? (balances.get(`${group.id}:${person.id}`) ?? 0) : 0
    friends.push({
      ...person,
      direct_group_id: group?.id ?? null,
      net_cents: theirNet === 0 ? 0 : -theirNet,
      currency: group?.currency ?? null,
    })
  }
  return friends.sort((a, b) => a.display_name.localeCompare(b.display_name))
}

export const friendsQueryOptions = (client: PotluckClient, viewerId: string) =>
  queryOptions({
    queryKey: groupKeys.friends(viewerId),
    queryFn: () => fetchFriends(client, viewerId),
  })

/** The 1:1 group with a friend, created on first use. */
export async function getOrCreateDirectGroup(
  client: PotluckClient,
  friendId: string,
): Promise<string> {
  const { data, error } = await client.rpc('get_or_create_direct_group', { friend_id: friendId })
  if (error) throw error
  return data
}
