/**
 * plans queries and mutations. Platform-neutral: no DOM imports.
 *
 * Every function takes the client first so web and mobile can pass their own.
 */
import { queryOptions } from '@tanstack/react-query'
import type { Database } from './database.types'
import type { PotluckClient } from './index'

type Tables = Database['public']['Tables']
type Functions = Database['public']['Functions']

export type PlanEvent = Tables['events']['Row']
export type PlanEventStatus = Database['public']['Enums']['event_status']
export type RsvpStatus = Database['public']['Enums']['rsvp_status']
export type AvailabilityLevelDb = Database['public']['Enums']['availability_level']
export type PlanTimelineItem = Functions['my_timeline']['Returns'][number]
export type PlanBestSlot = Functions['best_slots']['Returns'][number]
export type PlanAvailabilityRow = Tables['availability']['Row']
export type PlanAvailabilityRequest = Tables['availability_requests']['Row']
export type PlanRsvp = Tables['event_rsvps']['Row']
export type PlanBusyBlock = Pick<
  Tables['busy_blocks']['Row'],
  'id' | 'starts_at' | 'ends_at' | 'source'
>
export type PlanComment = Pick<
  Tables['comments']['Row'],
  'id' | 'author_id' | 'body' | 'created_at' | 'event_id'
>

/** A group member as the planning screens need them. */
export interface PlanMember {
  userId: string
  role: Database['public']['Enums']['group_role']
  displayName: string
  avatarPath: string | null
  deleted: boolean
}

export interface PlanGroup {
  id: string
  name: string
  emoji: string | null
  color: string | null
  currency: string
  memberCount: number
}

export interface PlanProfile {
  id: string
  displayName: string
  timezone: string
  defaultCurrency: string
  locale: string
  avatarPath: string | null
}

/** One group's net for the viewer, in that group's currency. Positive means they are owed. */
export interface HomeBalance {
  groupId: string
  groupName: string
  groupEmoji: string | null
  currency: string
  netCents: number
}

/** Event with the group bits list screens show. */
export type PlanEventWithGroup = PlanEvent & {
  group: { name: string; emoji: string | null; color: string | null } | null
}

/**
 * Error carrying the stable snake_case code the database raises (`event_not_polling`,
 * `not_allowed`, ...). The UI maps the code to a string.
 */
export class PlanError extends Error {
  readonly code: string
  constructor(code: string, details?: string) {
    super(details ? `${code}: ${details}` : code)
    this.name = 'PlanError'
    this.code = code
  }
}

function fail(error: { message: string; details?: string | null } | null): never {
  throw new PlanError(error?.message || 'unknown', error?.details ?? undefined)
}

export const plansKeys = {
  all: ['potluck', 'plans'] as const,
  profile: (userId: string) => ['potluck', 'plans', 'profile', userId] as const,
  timeline: (from: string, to: string) => ['potluck', 'plans', 'timeline', from, to] as const,
  timelineAll: () => ['potluck', 'plans', 'timeline'] as const,
  past: () => ['potluck', 'plans', 'past'] as const,
  myGroups: () => ['potluck', 'plans', 'my-groups'] as const,
  homeBalances: (userId: string) => ['potluck', 'plans', 'home-balances', userId] as const,
  groupEvents: (groupId: string) => ['potluck', 'plans', 'group-events', groupId] as const,
  members: (groupId: string) => ['potluck', 'plans', 'members', groupId] as const,
  event: (eventId: string) => ['potluck', 'plans', 'event', eventId] as const,
  availability: (eventId: string) =>
    ['potluck', 'plans', 'event', eventId, 'availability'] as const,
  requests: (eventId: string) => ['potluck', 'plans', 'event', eventId, 'requests'] as const,
  rsvps: (eventId: string) => ['potluck', 'plans', 'event', eventId, 'rsvps'] as const,
  bestSlots: (eventId: string) => ['potluck', 'plans', 'event', eventId, 'best'] as const,
  comments: (eventId: string) => ['potluck', 'plans', 'event', eventId, 'comments'] as const,
  busy: (userId: string, from: string, to: string) =>
    ['potluck', 'plans', 'busy', userId, from, to] as const,
}

// Queries --------------------------------------------------------------------

export async function fetchPlanProfile(
  client: PotluckClient,
  userId: string,
): Promise<PlanProfile> {
  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, timezone, default_currency, locale, avatar_path')
    .eq('id', userId)
    .single()
  if (error) fail(error)
  return {
    id: data.id,
    displayName: data.display_name,
    timezone: data.timezone,
    defaultCurrency: data.default_currency,
    locale: data.locale,
    avatarPath: data.avatar_path,
  }
}

export async function fetchMyTimeline(
  client: PotluckClient,
  range: { from: string; to: string },
): Promise<PlanTimelineItem[]> {
  const { data, error } = await client.rpc('my_timeline', { from: range.from, to: range.to })
  if (error) fail(error)
  return data ?? []
}

/** Scheduled or finished events that already ended, newest first. */
export async function fetchPastEvents(
  client: PotluckClient,
  options: { before: string; limit?: number },
): Promise<PlanEventWithGroup[]> {
  const { data, error } = await client
    .from('events')
    .select('*, group:groups(name, emoji, color)')
    .in('status', ['scheduled', 'done'])
    .lt('ends_at', options.before)
    .order('starts_at', { ascending: false })
    .limit(options.limit ?? 20)
  if (error) fail(error)
  return (data ?? []) as PlanEventWithGroup[]
}

/** The viewer's groups (not direct 1:1 groups, not archived) with member counts. */
export async function fetchPlanGroups(client: PotluckClient): Promise<PlanGroup[]> {
  const { data, error } = await client
    .from('groups')
    .select('id, name, emoji, color, currency, is_direct, archived_at, group_members(count)')
    .eq('is_direct', false)
    .is('archived_at', null)
    .order('name')
  if (error) fail(error)
  return (data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    color: g.color,
    currency: g.currency,
    memberCount: (g.group_members as unknown as { count: number }[])[0]?.count ?? 0,
  }))
}

/** The viewer's net in every group they belong to (direct groups included). */
export async function fetchHomeBalances(
  client: PotluckClient,
  userId: string,
): Promise<HomeBalance[]> {
  const [balances, groups] = await Promise.all([
    client.from('group_balances').select('group_id, net_cents').eq('user_id', userId),
    client.from('groups').select('id, name, emoji, currency, is_direct'),
  ])
  if (balances.error) fail(balances.error)
  if (groups.error) fail(groups.error)
  const byId = new Map(groups.data.map((g) => [g.id, g]))
  const out: HomeBalance[] = []
  for (const row of balances.data) {
    const group = row.group_id ? byId.get(row.group_id) : undefined
    if (!group) continue
    out.push({
      groupId: group.id,
      groupName: group.name,
      groupEmoji: group.emoji,
      currency: group.currency,
      netCents: Number(row.net_cents ?? 0),
    })
  }
  return out
}

export async function fetchGroupEvents(
  client: PotluckClient,
  groupId: string,
): Promise<PlanEvent[]> {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) fail(error)
  return data ?? []
}

export async function fetchPlanMembers(
  client: PotluckClient,
  groupId: string,
): Promise<PlanMember[]> {
  const { data, error } = await client
    .from('group_members')
    .select('user_id, role, joined_at, profile:profiles(display_name, avatar_path, deleted_at)')
    .eq('group_id', groupId)
    .order('joined_at')
  if (error) fail(error)
  return (data ?? []).map((m) => {
    const profile = m.profile as {
      display_name: string
      avatar_path: string | null
      deleted_at: string | null
    } | null
    return {
      userId: m.user_id,
      role: m.role,
      displayName: profile?.display_name ?? '',
      avatarPath: profile?.avatar_path ?? null,
      deleted: !!profile?.deleted_at,
    }
  })
}

export async function fetchPlanEvent(
  client: PotluckClient,
  eventId: string,
): Promise<PlanEventWithGroup> {
  const { data, error } = await client
    .from('events')
    .select('*, group:groups(name, emoji, color)')
    .eq('id', eventId)
    .maybeSingle()
  if (error) fail(error)
  if (!data) throw new PlanError('event_not_found')
  return data as PlanEventWithGroup
}

export async function fetchEventAvailability(
  client: PotluckClient,
  eventId: string,
): Promise<PlanAvailabilityRow[]> {
  const { data, error } = await client
    .from('availability')
    .select('event_id, user_id, slot_start, level')
    .eq('event_id', eventId)
  if (error) fail(error)
  return data ?? []
}

export async function fetchAvailabilityRequests(
  client: PotluckClient,
  eventId: string,
): Promise<PlanAvailabilityRequest[]> {
  const { data, error } = await client
    .from('availability_requests')
    .select('*')
    .eq('event_id', eventId)
  if (error) fail(error)
  return data ?? []
}

export async function fetchEventRsvps(client: PotluckClient, eventId: string): Promise<PlanRsvp[]> {
  const { data, error } = await client.from('event_rsvps').select('*').eq('event_id', eventId)
  if (error) fail(error)
  return data ?? []
}

export async function fetchBestSlots(
  client: PotluckClient,
  eventId: string,
  limit = 5,
): Promise<PlanBestSlot[]> {
  const { data, error } = await client.rpc('best_slots', { event_id: eventId, limit })
  if (error) fail(error)
  return data ?? []
}

/** The viewer's own imported busy time overlapping [from, to). */
export async function fetchBusyBlocks(
  client: PotluckClient,
  range: { from: string; to: string },
): Promise<PlanBusyBlock[]> {
  const { data, error } = await client
    .from('busy_blocks')
    .select('id, starts_at, ends_at, source')
    .lt('starts_at', range.to)
    .gt('ends_at', range.from)
  if (error) fail(error)
  return data ?? []
}

export async function fetchEventComments(
  client: PotluckClient,
  eventId: string,
): Promise<PlanComment[]> {
  const { data, error } = await client
    .from('comments')
    .select('id, author_id, body, created_at, event_id')
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at')
    .limit(200)
  if (error) fail(error)
  return data ?? []
}

/** Public URL of an avatar in the `avatars` bucket. */
export function planAvatarUrl(client: PotluckClient, path: string | null): string | null {
  if (!path) return null
  return client.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

// Query options --------------------------------------------------------------

export const planQueries = {
  profile: (client: PotluckClient, userId: string) =>
    queryOptions({
      queryKey: plansKeys.profile(userId),
      queryFn: () => fetchPlanProfile(client, userId),
      staleTime: 5 * 60_000,
    }),
  timeline: (client: PotluckClient, range: { from: string; to: string }) =>
    queryOptions({
      queryKey: plansKeys.timeline(range.from, range.to),
      queryFn: () => fetchMyTimeline(client, range),
    }),
  past: (client: PotluckClient, before: string) =>
    queryOptions({
      queryKey: plansKeys.past(),
      queryFn: () => fetchPastEvents(client, { before }),
    }),
  groups: (client: PotluckClient) =>
    queryOptions({ queryKey: plansKeys.myGroups(), queryFn: () => fetchPlanGroups(client) }),
  homeBalances: (client: PotluckClient, userId: string) =>
    queryOptions({
      queryKey: plansKeys.homeBalances(userId),
      queryFn: () => fetchHomeBalances(client, userId),
    }),
  groupEvents: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: plansKeys.groupEvents(groupId),
      queryFn: () => fetchGroupEvents(client, groupId),
    }),
  members: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: plansKeys.members(groupId),
      queryFn: () => fetchPlanMembers(client, groupId),
      staleTime: 60_000,
    }),
  event: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.event(eventId),
      queryFn: () => fetchPlanEvent(client, eventId),
    }),
  availability: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.availability(eventId),
      queryFn: () => fetchEventAvailability(client, eventId),
    }),
  requests: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.requests(eventId),
      queryFn: () => fetchAvailabilityRequests(client, eventId),
    }),
  rsvps: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.rsvps(eventId),
      queryFn: () => fetchEventRsvps(client, eventId),
    }),
  bestSlots: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.bestSlots(eventId),
      queryFn: () => fetchBestSlots(client, eventId),
    }),
  comments: (client: PotluckClient, eventId: string) =>
    queryOptions({
      queryKey: plansKeys.comments(eventId),
      queryFn: () => fetchEventComments(client, eventId),
    }),
  busy: (client: PotluckClient, userId: string, range: { from: string; to: string }) =>
    queryOptions({
      queryKey: plansKeys.busy(userId, range.from, range.to),
      queryFn: () => fetchBusyBlocks(client, range),
      staleTime: 5 * 60_000,
    }),
}

// Mutations ------------------------------------------------------------------

export interface CreatePlanInput {
  group_id: string
  title: string
  description: string | null
  location: string | null
  emoji: string | null
  window_start: string
  window_end: string
  day_start_minute: number
  day_end_minute: number
  slot_minutes: number
  duration_minutes: number
  min_attendees: number
  rsvp_deadline: string | null
  /** IANA zone the window and daily hours are in (the creator's zone). */
  timezone: string
}

export async function createPlanEvent(
  client: PotluckClient,
  input: CreatePlanInput,
): Promise<PlanEvent> {
  const { data, error } = await client.from('events').insert(input).select('*').single()
  if (error) fail(error)
  return data
}

/** Asks people to add their times. `userIds` null or empty asks everyone who has not answered. */
export async function requestAvailability(
  client: PotluckClient,
  eventId: string,
  userIds: string[] | null,
): Promise<number> {
  const { data, error } = await client.rpc('request_availability', {
    event_id: eventId,
    ...(userIds && userIds.length ? { user_ids: userIds } : {}),
  })
  if (error) fail(error)
  return data ?? 0
}

/** Replaces the viewer's availability for an event. */
export async function setAvailability(
  client: PotluckClient,
  eventId: string,
  slots: { slot_start: string; level: AvailabilityLevelDb }[],
): Promise<number> {
  const { data, error } = await client.rpc('set_availability', { event_id: eventId, slots })
  if (error) fail(error)
  return data ?? 0
}

export async function scheduleEvent(
  client: PotluckClient,
  eventId: string,
  startsAt: string,
): Promise<PlanEvent> {
  const { data, error } = await client.rpc('schedule_event', {
    event_id: eventId,
    starts_at: startsAt,
  })
  if (error) fail(error)
  return data as PlanEvent
}

export async function cancelEvent(client: PotluckClient, eventId: string): Promise<PlanEvent> {
  const { data, error } = await client.rpc('cancel_event', { event_id: eventId })
  if (error) fail(error)
  return data as PlanEvent
}

export async function setRsvp(
  client: PotluckClient,
  eventId: string,
  userId: string,
  status: RsvpStatus,
): Promise<void> {
  // Clients may only update `status`, so an upsert (which rewrites the key columns) is not
  // allowed: update first, insert when there was nothing to update.
  const updated = await client
    .from('event_rsvps')
    .update({ status })
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .select('event_id')
  if (updated.error) fail(updated.error)
  if (updated.data.length > 0) return
  const { error } = await client
    .from('event_rsvps')
    .insert({ event_id: eventId, user_id: userId, status })
  if (error) fail(error)
}

export async function addEventComment(
  client: PotluckClient,
  input: { eventId: string; body: string },
): Promise<PlanComment> {
  // group_id and author_id are filled on the server; clients may only send these columns.
  const row = { event_id: input.eventId, body: input.body } as Tables['comments']['Insert']
  const { data, error } = await client
    .from('comments')
    .insert(row)
    .select('id, author_id, body, created_at, event_id')
    .single()
  if (error) fail(error)
  return data
}
