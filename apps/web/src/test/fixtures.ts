import type { GroupDetail, GroupMember, GroupRole } from '@potluck/api'

export const VIEWER = 'u-ava'

export function member(
  id: string,
  name: string,
  role: GroupRole = 'member',
  net_cents = 0,
): GroupMember {
  return {
    id,
    display_name: name,
    avatar_path: null,
    deleted_at: null,
    role,
    joined_at: '2026-08-17T12:00:00Z',
    net_cents,
  }
}

export function group(overrides: Partial<GroupDetail> = {}): GroupDetail {
  const members = overrides.members ?? [
    member(VIEWER, 'Ava Chen', 'owner', -6051),
    member('u-ben', 'Ben Ortiz', 'admin', 4750),
    member('u-cleo', 'Cleo Park', 'member', 1301),
    member('u-dev', 'Dev Patel', 'member', 0),
  ]
  const me = members.find((m) => m.id === VIEWER)
  return {
    id: 'g-hike',
    name: 'Hike crew',
    emoji: '🥾',
    color: 'olive',
    cover_path: null,
    currency: 'USD',
    simplify_debts: true,
    members_can_invite: true,
    is_direct: false,
    created_by: VIEWER,
    created_at: '2026-08-17T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    archived_at: null,
    my_role: me?.role ?? null,
    my_net_cents: me?.net_cents ?? 0,
    ...overrides,
    members,
  }
}
