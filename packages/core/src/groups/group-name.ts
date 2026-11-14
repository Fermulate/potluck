/**
 * A group as people see it. A one-on-one tab between two friends (`groups.is_direct`) is stored
 * under a placeholder name nobody picked ("Direct"), so that name is never shown: the tab goes by
 * the other person instead, as `private.monthly_summary` names it in SQL.
 */
export interface NamedGroup {
  name: string
  isDirect: boolean
  /** Everyone in the group, the viewer included. */
  memberIds: readonly string[]
}

/** The other person in a one-on-one tab, or null for a group (or a tab nobody else is in). */
export function directFriendId(group: NamedGroup, viewerId: string): string | null {
  if (!group.isDirect) return null
  return group.memberIds.find((id) => id !== viewerId) ?? null
}

/**
 * The group's name, or for a one-on-one tab the other person's name from `nameOf`.
 * `fallback` names a tab whose other person is unknown, so the stored name never shows.
 */
export function groupDisplayName(
  group: NamedGroup,
  viewerId: string,
  nameOf: (id: string) => string | undefined,
  fallback: string,
): string {
  if (!group.isDirect) return group.name
  const friend = directFriendId(group, viewerId)
  return (friend && nameOf(friend)) || fallback
}
