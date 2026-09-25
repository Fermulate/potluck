/** Matches the `group_role` enum. */
export type GroupRole = 'owner' | 'admin' | 'member'

/** Context each action needs. `undefined` means the action takes no context. */
export interface ActionContext {
  'expense.create': undefined
  /** `isOwn`: the viewer created (or paid) the expense. */
  'expense.edit': { isOwn: boolean }
  'expense.delete': { isOwn: boolean }
  'availability.set': undefined
  'availability.request': undefined
  'rsvp.set': undefined
  'comment.create': undefined
  'event.create': undefined
  'event.lock': { isCreator: boolean }
  'event.cancel': { isCreator: boolean }
  'invite.create': { membersCanInvite: boolean }
  'member.remove': { targetRole: GroupRole; targetNetCents: number }
  'member.changeRole': { targetRole: GroupRole; newRole: GroupRole }
  'group.edit': undefined
  'group.delete': undefined
  'group.transferOwnership': undefined
  'group.leave': { netCents: number }
}

export type Action = keyof ActionContext

type ContextArgs<A extends Action> = ActionContext[A] extends undefined ? [] : [ActionContext[A]]

const isManager = (role: GroupRole) => role === 'owner' || role === 'admin'

type Rule<A extends Action> = (role: GroupRole, ctx: ActionContext[A]) => boolean
const anyone = () => true

const RULES: { [A in Action]: Rule<A> } = {
  'expense.create': anyone,
  'expense.edit': (role, { isOwn }) => isOwn || isManager(role),
  'expense.delete': (role, { isOwn }) => isOwn || isManager(role),
  'availability.set': anyone,
  'availability.request': anyone,
  'rsvp.set': anyone,
  'comment.create': anyone,
  'event.create': anyone,
  'event.lock': (role, { isCreator }) => isCreator || isManager(role),
  'event.cancel': (role, { isCreator }) => isCreator || isManager(role),
  'invite.create': (role, { membersCanInvite }) => membersCanInvite || isManager(role),
  'member.remove': (role, { targetRole, targetNetCents }) =>
    targetNetCents === 0 &&
    ((role === 'owner' && targetRole !== 'owner') || (role === 'admin' && targetRole === 'member')),
  'member.changeRole': (role, { targetRole, newRole }) =>
    newRole !== 'owner' &&
    newRole !== targetRole &&
    ((role === 'owner' && targetRole !== 'owner') || (role === 'admin' && targetRole === 'member')),
  'group.edit': isManager,
  'group.delete': (role) => role === 'owner',
  'group.transferOwnership': (role) => role === 'owner',
  // The owner has to transfer ownership before leaving.
  'group.leave': (role, { netCents }) => role !== 'owner' && netCents === 0,
}

/**
 * Whether a member with `role` may perform `action`, mirroring the role matrix in
 * docs/architecture.md. For showing and hiding controls only: RLS and the RPCs enforce the
 * same rules on the server. A null role (not a member) can do nothing.
 */
export function can<A extends Action>(
  role: GroupRole | null | undefined,
  action: A,
  ...[ctx]: ContextArgs<A>
): boolean {
  if (!role) return false
  return (RULES[action] as Rule<A>)(role, ctx as ActionContext[A])
}
