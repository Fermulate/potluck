import { VIEWER } from './fixtures'

/** A plan row as `events` stores it, with the joined group the queries select. */
export function planEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    group_id: 'g-hike',
    title: 'Taco night',
    description: 'Bring a topping.',
    location: 'Ava’s place',
    emoji: '🌮',
    status: 'polling',
    created_by: VIEWER,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    window_start: '2026-11-10',
    window_end: '2026-11-12',
    day_start_minute: 18 * 60,
    day_end_minute: 22 * 60,
    slot_minutes: 30,
    duration_minutes: 120,
    min_attendees: 3,
    rsvp_deadline: null,
    starts_at: null,
    ends_at: null,
    timezone: 'UTC',
    group: { name: 'Hike crew', emoji: '🥾', color: 'olive' },
    ...overrides,
  }
}

/** `group_members` rows as `fetchPlanMembers` selects them. */
export function planMemberRows(
  people: [id: string, name: string, role?: string][] = [
    [VIEWER, 'Ava Chen', 'owner'],
    ['u-ben', 'Ben Ortiz', 'member'],
    ['u-cleo', 'Cleo Park', 'member'],
  ],
  groupId = 'g-hike',
) {
  return people.map(([user_id, display_name, role = 'member'], i) => ({
    group_id: groupId,
    user_id,
    role,
    joined_at: `2026-08-0${i + 1}T00:00:00Z`,
    profile: { display_name, avatar_path: null, deleted_at: null },
  }))
}

export const viewerProfile = {
  id: VIEWER,
  display_name: 'Ava Chen',
  timezone: 'UTC',
  default_currency: 'USD',
  locale: 'en',
  avatar_path: null,
}
