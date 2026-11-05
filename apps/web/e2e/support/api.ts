import {
  acceptInvite,
  createExpense,
  createGroup,
  createInvite,
  type ExpensePayload,
} from '@potluck/api'
import { unique, type TestUser } from './fixtures'

export interface TestGroup {
  id: string
  name: string
}

/** A fresh group owned by `owner` with everyone in `members` joined through an invite. */
export async function groupWith(
  owner: TestUser,
  members: TestUser[] = [],
  options: { name?: string; currency?: string } = {},
): Promise<TestGroup> {
  const name = options.name ?? unique('Group')
  const group = await createGroup(owner.client, {
    name,
    emoji: '🧺',
    color: 'saffron',
    currency: options.currency ?? 'USD',
  })
  if (members.length > 0) {
    const invite = await createInvite(owner.client, { groupId: group.id })
    for (const member of members) await acceptInvite(member.client, invite.code)
  }
  return { id: group.id, name }
}

/** An equal split between `among`, paid by `payer`. */
export async function addEqualExpense(
  payer: TestUser,
  group: TestGroup,
  among: TestUser[],
  amountCents: number,
  description = unique('Expense'),
  extra: Partial<ExpensePayload> = {},
) {
  return createExpense(payer.client, {
    group_id: group.id,
    description,
    amount_cents: amountCents,
    currency: 'USD',
    paid_by: payer.id,
    split_type: 'equal',
    splits: among.map((u) => ({ user_id: u.id })),
    spent_at: new Date().toISOString().slice(0, 10),
    ...extra,
  })
}
