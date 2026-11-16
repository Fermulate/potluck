import type { Settlement } from '@potluck/api'
import { can, type GroupRole } from '@potluck/core'

/**
 * Whether the viewer may edit this payment, the rule behind the Edit button on its page and in
 * its menu in the expenses list, and behind its edit route. The blocked side of a 1:1 tab may
 * change only the payments they recorded (the server's rule); `blockedInTab` is undefined until
 * that is known, and so is the answer, so nothing appears and then vanishes. Deleted payments and
 * archived groups are read only.
 */
export function mayEditPayment(
  p: Settlement,
  {
    viewerId,
    role,
    blockedInTab,
    archived,
  }: {
    viewerId: string
    role: GroupRole | undefined
    blockedInTab: boolean | undefined
    archived: boolean
  },
): boolean | undefined {
  if (p.deleted_at || archived) return false
  if (blockedInTab === undefined) return undefined
  if (blockedInTab && p.created_by !== viewerId) return false
  const isParty = [p.from_user, p.to_user, p.created_by].includes(viewerId)
  return can(role, 'settlement.edit', { isParty })
}
