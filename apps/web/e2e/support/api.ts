import {
  acceptInvite,
  createExpense,
  createGroup,
  createGuestLink,
  createInvite,
  createPlanEvent,
  createQuickPoll,
  setQuickPollAvailability,
  type CreateQuickPollInput,
  type ExpensePayload,
} from '@potluck/api'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { repoRoot, stackEnv } from './env'
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

/**
 * Empties the quick poll create log on the local database. Creating is limited to 5 polls an
 * hour per client address and every local call shares one address, so each test that makes a
 * poll starts here; the limit itself stays as it is. Runs psql inside the local stack's database
 * container (the stack's `project_id` names it), never against a hosted project.
 */
export function clearQuickPollCreates() {
  const config = readFileSync(`${repoRoot}supabase/config.toml`, 'utf8')
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1] ?? 'potluck'
  execFileSync(
    'docker',
    [
      'exec',
      `supabase_db_${projectId}`,
      'psql',
      '-U',
      'postgres',
      '-tAc',
      'delete from private.quick_poll_creates',
    ],
    { stdio: 'ignore' },
  )
}

/** A client with no account, like a browser that never signed in. */
function anonymousClient() {
  const env = stackEnv()
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * A quick poll made without an account: tomorrow and the day after, 10:00 to 12:00 UTC, one hour
 * long. Returns its code and the creator token.
 */
export async function quickPoll(input: Partial<CreateQuickPollInput> = {}) {
  clearQuickPollCreates()
  return createQuickPoll(anonymousClient(), {
    title: unique('Picnic'),
    timeZone: 'UTC',
    windowStart: dayFromToday(1),
    windowEnd: dayFromToday(2),
    dayStartMinute: 600,
    dayEndMinute: 720,
    durationMinutes: 60,
    slotMinutes: 30,
    ttl: '7d',
    namesRequired: true,
    maxPeople: 10,
    ...input,
  })
}

/** Someone without an account answers `code` with tomorrow 10:00 to 11:00; returns their token. */
export async function answerQuickPoll(code: string, name: string, token: string | null = null) {
  const day = dayFromToday(1)
  const saved = await setQuickPollAvailability(anonymousClient(), {
    code,
    name,
    token,
    slots: [
      { slot_start: `${day}T10:00:00.000Z`, level: 'yes' },
      { slot_start: `${day}T10:30:00.000Z`, level: 'yes' },
    ],
  })
  return saved.token
}
