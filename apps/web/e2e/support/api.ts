import {
  acceptInvite,
  createExpense,
  createGroup,
  createGuestLink,
  createInvite,
  createPlanEvent,
  type ExpensePayload,
} from '@potluck/api'
import { createClient } from '@supabase/supabase-js'
import { stackEnv } from './env'
import { unique, type TestUser } from './fixtures'

/** `days` from today as YYYY-MM-DD (UTC, like every e2e user). */
export function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** A polling plan for tomorrow and the day after, 10:00 to 12:00 UTC, one hour long. */
export async function pollIn(owner: TestUser, group: TestGroup, title = unique('Plan')) {
  return createPlanEvent(owner.client, {
    group_id: group.id,
    title,
    description: null,
    location: null,
    emoji: '🥟',
    window_start: dayFromToday(1),
    window_end: dayFromToday(2),
    day_start_minute: 600,
    day_end_minute: 720,
    slot_minutes: 30,
    duration_minutes: 60,
    min_attendees: 1,
    rsvp_deadline: null,
    timezone: 'UTC',
  })
}

/** A guest link on `eventId` made by `owner`; returns its code and id. */
export async function guestLinkFor(owner: TestUser, eventId: string, maxGuests = 10) {
  return createGuestLink(owner.client, { eventId, ttl: '7d', maxGuests })
}

/** Moves a guest link's expiry into the past, as the service role (no client can do this). */
export async function expireGuestLink(linkId: string) {
  const env = stackEnv()
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await admin
    .from('event_guest_links')
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', linkId)
  if (error) throw new Error(error.message)
}

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
